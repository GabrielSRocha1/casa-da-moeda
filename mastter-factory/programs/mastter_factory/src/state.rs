//! Estruturas de estado on-chain. Todas as contas usam `InitSpace` para
//! dimensionamento exato (8 bytes de discriminador + INIT_SPACE).
use crate::constants::*;
use crate::errors::FactoryError;
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum VaultStatus {
    /// Cadastrado, aguardando `activate_entity_vault`.
    PendingActivation,
    Active,
    Paused,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum PaymentAsset {
    Sol,
    Usdc,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum ConfigScope {
    Factory,
    AdminTransfer,
    EntityVault,
    Registry,
    MintAuthorityRevoked,
}

/// Configuração global da Factory (PDA ["config"]).
#[account]
#[derive(InitSpace)]
pub struct FactoryConfig {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    /// Carteira de receita padrão da Mastter.Digital (copiada para novos cofres).
    pub revenue_wallet: Pubkey,
    /// Mint do USDC (SPL Token clássico) aceito pelo protocolo.
    pub usdc_mint: Pubkey,
    pub usdc_decimals: u8,
    /// Programa dono das contas de preço (Pyth Solana Receiver).
    pub oracle_program: Pubkey,
    pub sol_price_account: Pubkey,
    pub usdc_price_account: Pubkey,
    pub sol_feed_id: [u8; 32],
    pub usdc_feed_id: [u8; 32],
    pub max_price_age_secs: u64,
    pub max_conf_bps: u16,
    pub default_fee_bps: u16,
    /// Offset UTC (segundos) usado apenas para sinalizar a janela recomendada das injeções.
    pub ops_utc_offset_secs: i32,
    pub paused: bool,
    pub entity_count: u64,
    pub bump: u8,
    pub reserved: [u8; 64],
}

/// Cofre de uma entidade (PDA ["entity_vault", entity_id LE]).
#[account]
#[derive(InitSpace)]
pub struct EntityVault {
    pub entity_id: u64,
    pub contract_number: u64,
    /// Autoridade administrativa (espelho do admin da Factory no último ato administrativo).
    pub authority: Pubkey,
    /// Remetente autorizado de `inject_daily_profit`.
    pub profit_injector: Pubkey,
    /// Destino exclusivo e imutável do vesting.
    pub verum_wallet: Pubkey,
    /// Carteira de receita autorizada (taxas).
    pub revenue_wallet: Pubkey,
    pub mint: Pubkey,
    pub sol_treasury: Pubkey,
    pub usdc_treasury: Pubkey,
    pub ledger: Pubkey,
    pub vesting: Pubkey,
    pub registry: Pubkey,
    #[max_len(MAX_TOKEN_NAME_LEN)]
    pub token_name: String,
    #[max_len(MAX_TOKEN_SYMBOL_LEN)]
    pub token_symbol: String,
    pub decimals: u8,
    /// Hard Cap em tokens inteiros (25M / 50M / 100M).
    pub hard_cap_tokens: u64,
    /// Hard Cap em unidades-base (hard_cap_tokens * 10^decimals).
    pub hard_cap: u64,
    /// Lastro inicial em USDC (unidades-base) aportado na ativação.
    pub initial_pool_amount: u64,
    pub min_buy: u64,
    pub max_buy: u64,
    pub max_wallet: u64,
    pub platform_fee_bps: u16,
    pub charge_fee_on_profit: bool,
    /// Supply em circulação (fora do vesting).
    pub circulating_supply: u64,
    /// Supply bloqueado no escrow de vesting.
    pub vesting_locked_supply: u64,
    pub total_minted: u64,
    pub total_burned: u64,
    pub status: VaultStatus,
    pub minting_closed: bool,
    pub created_at: i64,
    pub activated_at: i64,
    pub bump: u8,
    pub mint_bump: u8,
    pub sol_treasury_bump: u8,
    pub usdc_treasury_bump: u8,
    pub ledger_bump: u8,
    pub vesting_bump: u8,
    pub vesting_escrow_bump: u8,
    pub registry_bump: u8,
    /// SHA-256 do arquivo de imagem do token. Gravado uma única vez na ativação;
    /// nenhuma instrução o altera. Permite provar que a imagem nunca mudou.
    pub image_sha256: [u8; 32],
    pub reserved: [u8; 32],
}

impl EntityVault {
    /// Supply de referência da precificação: circulante + bloqueado em vesting.
    /// Política: tokens em vesting participam do lastro pro-rata desde o início,
    /// de modo que o claim não dilui os demais detentores.
    pub fn reference_supply(&self) -> Result<u64> {
        self.circulating_supply
            .checked_add(self.vesting_locked_supply)
            .ok_or_else(|| error!(FactoryError::MathOverflow))
    }

    pub fn require_active(&self) -> Result<()> {
        require!(self.status == VaultStatus::Active, FactoryError::VaultNotActive);
        Ok(())
    }
}

/// Controle de lastro, taxas e histórico agregado (PDA ["ledger", vault]).
#[account]
#[derive(InitSpace)]
pub struct BackingLedger {
    pub vault: Pubkey,
    /// Lastro contabilizado (somente entradas via programa; doações diretas não contam).
    pub sol_backing: u64,
    pub usdc_backing: u64,
    /// Receita da plataforma (já repassada à carteira de receita; nunca compõe o lastro).
    pub sol_fees_collected: u64,
    pub usdc_fees_collected: u64,
    /// Depósitos de lucro (líquidos) acumulados.
    pub sol_profit_injected: u64,
    pub usdc_profit_injected: u64,
    /// Entradas líquidas por compras.
    pub sol_buy_inflow: u64,
    pub usdc_buy_inflow: u64,
    /// Saídas brutas por resgates.
    pub sol_redeemed: u64,
    pub usdc_redeemed: u64,
    pub buy_count: u64,
    pub sell_count: u64,
    pub profit_count: u64,
    pub claim_count: u64,
    pub last_operation_ts: i64,
    pub bump: u8,
    pub reserved: [u8; 32],
}

/// Vesting de 30% do Hard Cap (PDA ["vesting", vault]).
#[account]
#[derive(InitSpace)]
pub struct VestingAccount {
    pub vault: Pubkey,
    pub mint: Pubkey,
    pub escrow: Pubkey,
    /// Destinatário autorizado (Verum Wallet).
    pub beneficiary: Pubkey,
    pub total_allocated: u64,
    pub released: u64,
    pub remaining: u64,
    pub start_ts: i64,
    pub cliff_ts: i64,
    pub end_ts: i64,
    pub last_claim_ts: i64,
    pub bump: u8,
}

/// Dados cadastrais da entidade (PDA ["registry", vault]).
#[account]
#[derive(InitSpace)]
pub struct RegistryData {
    pub vault: Pubkey,
    pub entity_id: u64,
    pub contract_number: u64,
    #[max_len(MAX_COMPANY_NAME_LEN)]
    pub company_name: String,
    #[max_len(MAX_ADDRESS_LEN)]
    pub address: String,
    #[max_len(MAX_PHONE_LEN)]
    pub phone: String,
    #[max_len(MAX_COUNTRY_LEN)]
    pub country: String,
    #[max_len(MAX_DIRECTORS_LEN)]
    pub directors_names: String,
    #[max_len(MAX_PAYER_NAME_LEN)]
    pub payer_name: String,
    /// Histórico de registro.
    pub registered_by: Pubkey,
    pub registered_at: i64,
    pub last_updated_by: Pubkey,
    pub last_updated_at: i64,
    pub update_count: u32,
    pub bump: u8,
}

/// Controle de compras por carteira (PDA ["buyer", vault, buyer]).
#[account]
#[derive(InitSpace)]
pub struct BuyerRecord {
    pub vault: Pubkey,
    pub buyer: Pubkey,
    pub total_purchased: u64,
    pub total_sold: u64,
    /// Compras líquidas (compradas - resgatadas) via programa; limitado a max_wallet.
    pub net_acquired: u64,
    pub purchase_count: u32,
    pub last_purchase_ts: i64,
    pub bump: u8,
}

/// Recibo de injeção de lucro (PDA ["profit", vault, reference_id LE]).
/// A criação com `init` impede a duplicação do mesmo repasse.
#[account]
#[derive(InitSpace)]
pub struct ProfitReceipt {
    pub vault: Pubkey,
    pub entity_id: u64,
    pub reference_id: u64,
    pub injector: Pubkey,
    #[max_len(MAX_ORIGIN_LEN)]
    pub origin: String,
    pub asset: PaymentAsset,
    pub gross_amount: u64,
    pub fee_amount: u64,
    pub net_amount: u64,
    pub timestamp: i64,
    pub local_hour: u8,
    pub local_weekday: u8,
    pub within_recommended_window: bool,
    pub bump: u8,
}

pub fn check_str(s: &str, max: usize, allow_empty: bool) -> Result<()> {
    require!(s.len() <= max, FactoryError::InvalidStringLength);
    require!(allow_empty || !s.trim().is_empty(), FactoryError::InvalidStringLength);
    Ok(())
}
