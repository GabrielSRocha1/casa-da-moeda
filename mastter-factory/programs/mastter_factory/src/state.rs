use anchor_lang::prelude::*;

pub const POOL_SEED: &[u8] = b"pool";
pub const TOKEN_VAULT_SEED: &[u8] = b"token_vault";
pub const QUOTE_VAULT_SEED: &[u8] = b"quote_vault";
pub const DEPOSIT_SEED: &[u8] = b"deposit";

/// Estado do cofre de um token. PDA: ["pool", token_mint].
///
/// Não existe nenhum campo, instrução ou autoridade capaz de retirar USDC do
/// `quote_vault` — a única saída é `sell`, que exige entrega de tokens.
#[account]
#[derive(InitSpace)]
pub struct Pool {
    /// Administração: só pode pausar compras/injeções e transferir a própria função.
    pub authority: Pubkey,
    /// Transferência de administração em duas etapas (Pubkey::default() = nenhuma).
    pub pending_authority: Pubkey,

    pub token_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub token_vault: Pubkey,
    pub quote_vault: Pubkey,
    pub token_decimals: u8,
    pub quote_decimals: u8,

    /// Teto de emissão, fixado na criação e imutável.
    pub max_supply: u64,
    /// Total já cunhado (monotônico).
    pub minted_total: u64,
    /// Preço da fase 1: unidades atômicas de quote por 1 token inteiro × 1e9. Imutável.
    pub initial_price: u64,
    /// Taxas imutáveis, retidas no próprio cofre.
    pub buy_fee_bps: u16,
    pub sell_fee_bps: u16,

    pub minting_completed: bool,
    pub minting_completed_at: i64,
    /// Pausa bloqueia compras e injeções. Vendas NUNCA são pausáveis.
    pub paused: bool,

    // Contabilidade de auditoria
    pub total_quote_from_buys: u64,
    pub total_quote_injected: u64,
    pub total_quote_paid_on_sells: u64,
    pub total_tokens_bought: u64,
    pub total_tokens_sold: u64,
    pub deposit_count: u64,

    pub bump: u8,
    pub token_vault_bump: u8,
    pub quote_vault_bump: u8,
}

/// Registro individual de cada injeção de capital sem token.
/// PDA: ["deposit", pool, reference] — a mesma referência não pode ser usada duas vezes.
#[account]
#[derive(InitSpace)]
pub struct DepositRecord {
    pub pool: Pubkey,
    pub depositor: Pubkey,
    /// Identificador externo (ex.: hash do comprovante Pix/TxID de origem).
    pub reference: [u8; 32],
    pub amount: u64,
    pub index: u64,
    pub slot: u64,
    pub timestamp: i64,
    /// Fase no momento do depósito (false = cunhagem, true = capitalização).
    pub during_capitalization: bool,
    pub bump: u8,
}
