//! Casa da Moeda Master Digital — Cofre de Cunhagem Evolutiva (Solana / Anchor)
//!
//! - O token nasce com teto de supply programado e supply 0.
//! - Fase 1: cada compra cunha tokens ao preço fixo (dinheiro entra, token sai).
//! - Ao cunhar o último token, a autoridade de cunhagem é revogada para sempre
//!   e o preço passa a ser `USDC no cofre / tokens em circulação`.
//! - USDC pode ser depositado a qualquer momento sem gerar tokens.
//! - USDC só sai do cofre por venda de tokens. Não há função de saque.

use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;

declare_id!("FZ4dYHSvFs9eF1TnN9QLj5XUuhD3yWqM1us9itqjhrE9");

#[program]
pub mod mastter_factory {
    use super::*;

    pub fn initialize_pool(ctx: Context<InitializePool>, params: InitializePoolParams) -> Result<()> {
        instructions::initialize_pool::handle_initialize_pool(ctx, params)
    }

    pub fn buy(ctx: Context<Buy>, quote_in: u64, min_tokens_out: u64) -> Result<()> {
        instructions::buy::handle_buy(ctx, quote_in, min_tokens_out)
    }

    pub fn sell(ctx: Context<Sell>, tokens_in: u64, min_quote_out: u64) -> Result<()> {
        instructions::sell::handle_sell(ctx, tokens_in, min_quote_out)
    }

    pub fn inject_quote(ctx: Context<InjectQuote>, amount: u64, reference: [u8; 32]) -> Result<()> {
        instructions::inject_quote::handle_inject_quote(ctx, amount, reference)
    }

    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        instructions::admin::handle_set_paused(ctx, paused)
    }

    pub fn propose_authority(ctx: Context<AdminOnly>, new_authority: Pubkey) -> Result<()> {
        instructions::admin::handle_propose_authority(ctx, new_authority)
    }

    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        instructions::admin::handle_accept_authority(ctx)
    }
}
