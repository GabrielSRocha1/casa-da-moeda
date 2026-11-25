//! Matemática pura do cofre (sem dependência de Solana) — testável isoladamente.
//!
//! Modelo econômico:
//! - FASE 1 (cunhagem progressiva): preço fixo `initial_price`. Cada compra entrega
//!   tokens do estoque do cofre (devolvidos por vendas) e cunha o restante, até o teto
//!   `max_supply`. Vendas pagam o mesmo preço fixo.
//! - FASE 2 (capitalização): após cunhar o último token, o preço passa a ser
//!   `reserva_usdc / tokens_em_circulação`. Compras e vendas preservam (ou elevam,
//!   pela taxa retida) esse preço; injeções de USDC sem token elevam o preço.
//!
//! Garantia central: USDC só sai do cofre em troca de tokens (venda). As taxas
//! ficam retidas no próprio cofre, valorizando o token.

pub const BPS: u64 = 10_000;
/// Escala do preço: `initial_price` = unidades atômicas de quote por 1 token inteiro × 1e9.
pub const PRICE_SCALE: u128 = 1_000_000_000;
pub const MAX_FEE_BPS: u16 = 1_000; // 10%
pub const MAX_TOKEN_DECIMALS: u8 = 9;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MathError {
    Overflow,
    ZeroAmount,
    ZeroOutput,
    InsufficientInventory,
    InsufficientReserve,
    SoldOut,
}

/// Fotografia do estado on-chain usada nos cálculos.
#[derive(Debug, Clone, Copy)]
pub struct Snapshot {
    pub minting_completed: bool,
    pub initial_price: u64,
    pub token_decimals: u8,
    pub max_supply: u64,
    /// Total já cunhado (monotônico; não diminui com queima).
    pub minted_total: u64,
    /// Tokens parados no cofre de tokens (saldo real da conta).
    pub inventory: u64,
    /// supply do mint − estoque do cofre.
    pub circulating: u64,
    /// Saldo real de USDC no cofre.
    pub quote_reserve: u64,
    pub buy_fee_bps: u16,
    pub sell_fee_bps: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BuyQuote {
    /// Quanto efetivamente sai da carteira do comprador (≤ quote_in).
    pub quote_charged: u64,
    /// Parte retida como taxa (fica no cofre).
    pub fee: u64,
    pub net_quote: u64,
    pub tokens_out: u64,
    pub from_inventory: u64,
    pub to_mint: u64,
    pub completes_minting: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SellQuote {
    pub gross_quote: u64,
    /// Taxa retida no cofre.
    pub fee: u64,
    /// Quanto o vendedor recebe (único fluxo de saída de USDC).
    pub net_quote: u64,
}

fn unit(decimals: u8) -> Result<u128, MathError> {
    10u128.checked_pow(decimals as u32).ok_or(MathError::Overflow)
}

fn to_u64(v: u128) -> Result<u64, MathError> {
    u64::try_from(v).map_err(|_| MathError::Overflow)
}

fn mul_div_floor(a: u128, b: u128, d: u128) -> Result<u128, MathError> {
    if d == 0 {
        return Err(MathError::Overflow);
    }
    a.checked_mul(b).ok_or(MathError::Overflow).map(|x| x / d)
}

fn mul_div_ceil(a: u128, b: u128, d: u128) -> Result<u128, MathError> {
    if d == 0 {
        return Err(MathError::Overflow);
    }
    let p = a.checked_mul(b).ok_or(MathError::Overflow)?;
    Ok(p / d + u128::from(p % d != 0))
}

fn fee_of(amount: u64, bps: u16) -> Result<u64, MathError> {
    to_u64(mul_div_floor(amount as u128, bps as u128, BPS as u128)?)
}

/// Tokens (atômicos) comprados com `quote` ao preço fixo — arredonda para baixo.
pub fn tokens_at_fixed_price(quote: u64, price: u64, decimals: u8) -> Result<u64, MathError> {
    let num = unit(decimals)?.checked_mul(PRICE_SCALE).ok_or(MathError::Overflow)?;
    to_u64(mul_div_floor(quote as u128, num, price as u128)?)
}

/// Quote (atômico) equivalente a `tokens` ao preço fixo — arredonda para baixo.
pub fn quote_at_fixed_price_floor(tokens: u64, price: u64, decimals: u8) -> Result<u64, MathError> {
    let den = unit(decimals)?.checked_mul(PRICE_SCALE).ok_or(MathError::Overflow)?;
    to_u64(mul_div_floor(tokens as u128, price as u128, den)?)
}

/// Quote (atômico) equivalente a `tokens` ao preço fixo — arredonda para cima.
pub fn quote_at_fixed_price_ceil(tokens: u64, price: u64, decimals: u8) -> Result<u64, MathError> {
    let den = unit(decimals)?.checked_mul(PRICE_SCALE).ok_or(MathError::Overflow)?;
    to_u64(mul_div_ceil(tokens as u128, price as u128, den)?)
}

/// Preço atual em unidades atômicas de quote por 1 token inteiro × PRICE_SCALE.
pub fn current_price(s: &Snapshot) -> Result<u64, MathError> {
    if !s.minting_completed || s.circulating == 0 || s.quote_reserve == 0 {
        return Ok(s.initial_price);
    }
    let num = (s.quote_reserve as u128)
        .checked_mul(unit(s.token_decimals)?)
        .ok_or(MathError::Overflow)?
        .checked_mul(PRICE_SCALE)
        .ok_or(MathError::Overflow)?;
    to_u64(num / s.circulating as u128)
}

pub fn quote_buy(s: &Snapshot, quote_in: u64) -> Result<BuyQuote, MathError> {
    if quote_in == 0 {
        return Err(MathError::ZeroAmount);
    }
    let fee = fee_of(quote_in, s.buy_fee_bps)?;
    let net = quote_in.checked_sub(fee).ok_or(MathError::Overflow)?;

    if !s.minting_completed {
        // ---------------- FASE 1: preço fixo, cunhagem sob demanda ----------------
        let mintable = s.max_supply.checked_sub(s.minted_total).ok_or(MathError::Overflow)?;
        let available = s.inventory.checked_add(mintable).ok_or(MathError::Overflow)?;
        if available == 0 {
            return Err(MathError::SoldOut);
        }
        let wanted = tokens_at_fixed_price(net, s.initial_price, s.token_decimals)?;
        if wanted == 0 {
            return Err(MathError::ZeroOutput);
        }

        let (tokens, charged, fee, net) = if wanted <= available {
            (wanted, quote_in, fee, net)
        } else {
            // Execução parcial: compra só o que resta e cobra apenas o necessário.
            let tokens = available;
            let net_needed = quote_at_fixed_price_ceil(tokens, s.initial_price, s.token_decimals)?;
            let fee_den = BPS - s.buy_fee_bps as u64;
            let charged = to_u64(mul_div_ceil(net_needed as u128, BPS as u128, fee_den as u128)?)?
                .min(quote_in);
            let fee = fee_of(charged, s.buy_fee_bps)?;
            let net = charged - fee;
            (tokens, charged, fee, net)
        };

        let from_inventory = tokens.min(s.inventory);
        let to_mint = tokens - from_inventory;
        let new_minted = s.minted_total.checked_add(to_mint).ok_or(MathError::Overflow)?;
        if new_minted > s.max_supply {
            return Err(MathError::Overflow);
        }
        return Ok(BuyQuote {
            quote_charged: charged,
            fee,
            net_quote: net,
            tokens_out: tokens,
            from_inventory,
            to_mint,
            completes_minting: new_minted == s.max_supply,
        });
    }

    // ---------------- FASE 2: preço = reserva / circulação ----------------
    let tokens = if s.circulating > 0 && s.quote_reserve > 0 {
        to_u64(mul_div_floor(net as u128, s.circulating as u128, s.quote_reserve as u128)?)?
    } else {
        // Caso-limite (ninguém em circulação): usa o MAIOR entre preço inicial e
        // reserva/max_supply, para não entregar a reserva barata ao primeiro comprador.
        let by_initial = tokens_at_fixed_price(net, s.initial_price, s.token_decimals)?;
        if s.quote_reserve > 0 {
            let by_reserve =
                to_u64(mul_div_floor(net as u128, s.max_supply as u128, s.quote_reserve as u128)?)?;
            by_initial.min(by_reserve)
        } else {
            by_initial
        }
    };
    if tokens == 0 {
        return Err(MathError::ZeroOutput);
    }
    if tokens > s.inventory {
        return Err(MathError::InsufficientInventory);
    }
    Ok(BuyQuote {
        quote_charged: quote_in,
        fee,
        net_quote: net,
        tokens_out: tokens,
        from_inventory: tokens,
        to_mint: 0,
        completes_minting: false,
    })
}

pub fn quote_sell(s: &Snapshot, tokens_in: u64) -> Result<SellQuote, MathError> {
    if tokens_in == 0 {
        return Err(MathError::ZeroAmount);
    }
    let gross = if !s.minting_completed {
        quote_at_fixed_price_floor(tokens_in, s.initial_price, s.token_decimals)?
    } else {
        if s.circulating == 0 || tokens_in > s.circulating {
            return Err(MathError::InsufficientReserve);
        }
        to_u64(mul_div_floor(tokens_in as u128, s.quote_reserve as u128, s.circulating as u128)?)?
    };
    let fee = fee_of(gross, s.sell_fee_bps)?;
    let net = gross - fee;
    if net == 0 {
        return Err(MathError::ZeroOutput);
    }
    if net > s.quote_reserve {
        return Err(MathError::InsufficientReserve);
    }
    Ok(SellQuote { gross_quote: gross, fee, net_quote: net })
}

#[cfg(test)]
mod tests {
    use super::*;

    const USDC: u64 = 1_000_000; // 6 casas
    const TK: u64 = 1_000_000_000; // 9 casas
    // US$ 0,001 por token = 1.000 unidades atômicas de USDC × 1e9
    const P0: u64 = 1_000 * 1_000_000_000;

    fn snap() -> Snapshot {
        Snapshot {
            minting_completed: false,
            initial_price: P0,
            token_decimals: 9,
            max_supply: 1_000_000 * TK,
            minted_total: 0,
            inventory: 0,
            circulating: 0,
            quote_reserve: 0,
            buy_fee_bps: 100,
            sell_fee_bps: 100,
        }
    }

    #[test]
    fn fase1_preco_fixo_e_taxa() {
        let q = quote_buy(&snap(), 100 * USDC).unwrap();
        assert_eq!(q.fee, USDC);
        assert_eq!(q.tokens_out, 99_000 * TK);
        assert_eq!(q.to_mint, 99_000 * TK);
        assert!(!q.completes_minting);
    }

    #[test]
    fn fase1_usa_estoque_antes_de_cunhar() {
        let mut s = snap();
        s.minted_total = 10_000 * TK;
        s.inventory = 3_000 * TK;
        s.circulating = 7_000 * TK;
        let q = quote_buy(&s, 10 * USDC).unwrap(); // 9.900 tokens
        assert_eq!(q.from_inventory, 3_000 * TK);
        assert_eq!(q.to_mint, 6_900 * TK);
    }

    #[test]
    fn fase1_execucao_parcial_no_ultimo_token() {
        let mut s = snap();
        s.minted_total = 999_000 * TK; // faltam 1.000 tokens = US$ 1 líquido
        s.circulating = s.minted_total;
        let q = quote_buy(&s, 50 * USDC).unwrap();
        assert_eq!(q.tokens_out, 1_000 * TK);
        assert!(q.completes_minting);
        // net precisa cobrir US$ 1; bruto = ceil(1e6 × 10000 / 9900)
        assert_eq!(q.net_quote + q.fee, q.quote_charged);
        assert!(q.net_quote >= USDC);
        assert_eq!(q.quote_charged, 1_010_102);
    }

    #[test]
    fn fase1_esgotado() {
        let mut s = snap();
        s.minted_total = s.max_supply;
        assert_eq!(quote_buy(&s, USDC), Err(MathError::SoldOut));
    }

    #[test]
    fn fase1_venda_preco_fixo() {
        let mut s = snap();
        s.minted_total = 1_000 * TK;
        s.circulating = 1_000 * TK;
        s.quote_reserve = USDC;
        let q = quote_sell(&s, 1_000 * TK).unwrap();
        assert_eq!(q.gross_quote, USDC);
        assert_eq!(q.fee, 10_000);
        assert_eq!(q.net_quote, 990_000);
    }

    #[test]
    fn fase2_preco_reserva_sobre_circulacao() {
        let mut s = snap();
        s.minting_completed = true;
        s.minted_total = s.max_supply;
        s.circulating = 500_000 * TK;
        s.inventory = 500_000 * TK;
        s.quote_reserve = 2_000 * USDC; // US$ 0,004 por token
        assert_eq!(current_price(&s).unwrap(), 4_000 * 1_000_000_000);
        let q = quote_buy(&s, 101 * USDC).unwrap(); // net 99,99 → 24.997,5 tokens
        assert_eq!(q.tokens_out, 24_997_500_000_000);
        let v = quote_sell(&s, 1_000 * TK).unwrap();
        assert_eq!(v.gross_quote, 4 * USDC);
    }

    #[test]
    fn fase2_estoque_insuficiente() {
        let mut s = snap();
        s.minting_completed = true;
        s.minted_total = s.max_supply;
        s.circulating = s.max_supply;
        s.inventory = 0;
        s.quote_reserve = 1_000 * USDC;
        assert_eq!(quote_buy(&s, USDC), Err(MathError::InsufficientInventory));
    }

    #[test]
    fn zeros_rejeitados() {
        assert_eq!(quote_buy(&snap(), 0), Err(MathError::ZeroAmount));
        assert_eq!(quote_sell(&snap(), 0), Err(MathError::ZeroAmount));
        let mut caro = snap();
        caro.initial_price = u64::MAX; // 1 unidade atômica de USDC não compra nada
        assert_eq!(quote_buy(&caro, 1), Err(MathError::ZeroOutput));
    }

    // ------------------------------------------------------------------------
    // Simulação aleatória: milhares de sequências de compra / venda / injeção.
    // Invariantes:
    //  1. USDC só sai por venda e nunca mais do que o vendedor tem direito;
    //  2. supply nunca passa do teto e não cresce após a conclusão;
    //  3. fase 1: reserva ≥ circulação × preço fixo (todos podem vender);
    //  4. fase 2: preço nunca cai com compras/vendas;
    //  5. ao final, todos os detentores conseguem vender tudo (solvência).
    // ------------------------------------------------------------------------
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }
        fn range(&mut self, n: u64) -> u64 {
            self.next() % n.max(1)
        }
    }

    #[derive(Clone)]
    struct Sim {
        s: Snapshot,
        supply: u64,
        holders: Vec<u64>,
        usdc_in: u128,
        usdc_out: u128,
    }

    impl Sim {
        fn new(max_supply: u64, fee: u16) -> Self {
            let mut s = snap();
            s.max_supply = max_supply;
            s.buy_fee_bps = fee;
            s.sell_fee_bps = fee;
            Sim { s, supply: 0, holders: vec![0; 5], usdc_in: 0, usdc_out: 0 }
        }
        fn sync(&mut self) {
            self.s.circulating = self.supply - self.s.inventory;
        }
        fn buy(&mut self, h: usize, amt: u64) {
            if let Ok(q) = quote_buy(&self.s, amt) {
                assert!(q.quote_charged <= amt);
                assert_eq!(q.from_inventory + q.to_mint, q.tokens_out);
                if self.s.minting_completed {
                    assert_eq!(q.to_mint, 0, "cunhagem após conclusão");
                }
                self.s.quote_reserve += q.quote_charged;
                self.usdc_in += q.quote_charged as u128;
                self.s.inventory -= q.from_inventory;
                self.supply += q.to_mint;
                self.s.minted_total += q.to_mint;
                assert!(self.s.minted_total <= self.s.max_supply);
                if q.completes_minting {
                    self.s.minting_completed = true;
                }
                self.holders[h] += q.tokens_out;
                self.sync();
            }
        }
        fn sell(&mut self, h: usize, amt: u64) {
            let amt = amt.min(self.holders[h]);
            if let Ok(q) = quote_sell(&self.s, amt) {
                assert!(q.net_quote <= self.s.quote_reserve);
                self.s.quote_reserve -= q.net_quote;
                self.usdc_out += q.net_quote as u128;
                self.holders[h] -= amt;
                self.s.inventory += amt;
                self.sync();
            }
        }
        fn inject(&mut self, amt: u64) {
            self.s.quote_reserve += amt;
            self.usdc_in += amt as u128;
        }
        fn check(&self) {
            assert_eq!(self.holders.iter().sum::<u64>(), self.s.circulating);
            assert!(self.usdc_out <= self.usdc_in);
            assert_eq!(self.usdc_in - self.usdc_out, self.s.quote_reserve as u128);
            if !self.s.minting_completed {
                let owed = quote_at_fixed_price_floor(self.s.circulating, P0, 9).unwrap();
                assert!(self.s.quote_reserve >= owed, "fase 1 insolvente");
            }
        }
    }

    #[test]
    fn simulacao_invariantes() {
        let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
        let mut rodadas_fase2 = 0;
        for round in 0..400 {
            let max_supply = (1_000 + rng.range(if round % 2 == 0 { 50_000 } else { 5_000_000 })) * TK;
            let fee = [0u16, 30, 100, 1_000][round % 4];
            let mut sim = Sim::new(max_supply, fee);
            for _ in 0..300 {
                let h = rng.range(5) as usize;
                let price_before = current_price(&sim.s).unwrap();
                let completed_before = sim.s.minting_completed;
                let (reserve_b, circ_b) = (sim.s.quote_reserve, sim.s.circulating);
                match rng.range(10) {
                    0..=4 => sim.buy(h, 1 + rng.range(30 * USDC)),
                    5..=8 => sim.sell(h, rng.range(sim.holders[h] + 1)),
                    _ => sim.inject(rng.range(5 * USDC)),
                }
                sim.check();
                // preço da fase 2 nunca cai por negociação (compara r/c cruzado)
                if completed_before && circ_b > 0 && sim.s.circulating > 0 {
                    let lhs = sim.s.quote_reserve as u128 * circ_b as u128;
                    let rhs = reserve_b as u128 * sim.s.circulating as u128;
                    assert!(lhs >= rhs, "preço caiu na fase 2");
                    let _ = price_before;
                }
            }
            if sim.s.minting_completed {
                rodadas_fase2 += 1;
            }
            // solvência final: todos vendem tudo (repete até não haver progresso)
            loop {
                let before: u64 = sim.holders.iter().sum();
                for h in 0..5 {
                    let amt = sim.holders[h];
                    sim.sell(h, amt);
                    sim.check();
                }
                if sim.holders.iter().sum::<u64>() == before {
                    break;
                }
            }
            // sobra apenas poeira que vale menos de 1 unidade atômica de USDC
            for &x in &sim.holders {
                if x > 0 {
                    assert_eq!(quote_sell(&sim.s, x), Err(MathError::ZeroOutput));
                }
            }
        }
        // garante que a simulação realmente exercitou as duas fases
        assert!(rodadas_fase2 > 50 && rodadas_fase2 < 380, "fase2={rodadas_fase2}");
        {
        }
    }

    #[test]
    fn injecao_eleva_preco_fase2() {
        let mut s = snap();
        s.minting_completed = true;
        s.minted_total = s.max_supply;
        s.circulating = 100_000 * TK;
        s.inventory = s.max_supply - s.circulating;
        s.quote_reserve = 100 * USDC;
        let p1 = current_price(&s).unwrap();
        s.quote_reserve += 100 * USDC; // injeção sem token
        let p2 = current_price(&s).unwrap();
        assert_eq!(p2, p1 * 2);
    }

    #[test]
    fn injecao_na_fase1_nao_muda_preco() {
        let mut s = snap();
        let p1 = current_price(&s).unwrap();
        s.quote_reserve += 1_000 * USDC;
        assert_eq!(current_price(&s).unwrap(), p1);
    }
}
