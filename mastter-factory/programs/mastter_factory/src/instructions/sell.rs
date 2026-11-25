use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::errors::{math_err, CasaError};
use crate::events::TokensSold;
use crate::instructions::snapshot;
use crate::math::{current_price, quote_sell};
use crate::state::*;

#[derive(Accounts)]
pub struct Sell<'info> {
    pub seller: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_SEED, token_mint.key().as_ref()],
        bump = pool.bump,
        has_one = token_mint,
        has_one = quote_mint,
        has_one = token_vault,
        has_one = quote_vault,
    )]
    pub pool: Box<Account<'info, Pool>>,

    pub token_mint: Box<Account<'info, Mint>>,
    pub quote_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub token_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub quote_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = token_mint,
        token::authority = seller,
    )]
    pub seller_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = quote_mint,
        token::authority = seller,
    )]
    pub seller_quote_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

/// ÚNICA forma de USDC sair do cofre: o vendedor entrega tokens e recebe USDC.
/// Não é afetada por pausa — o detentor sempre consegue sair.
pub fn handle_sell(ctx: Context<Sell>, tokens_in: u64, min_quote_out: u64) -> Result<()> {
    let snap = snapshot(
        &ctx.accounts.pool,
        &ctx.accounts.token_mint,
        &ctx.accounts.token_vault,
        &ctx.accounts.quote_vault,
    )?;
    let q = quote_sell(&snap, tokens_in).map_err(math_err)?;
    require!(q.net_quote >= min_quote_out, CasaError::SlippageExceeded);

    let token_mint_key = ctx.accounts.token_mint.key();
    let bump = ctx.accounts.pool.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[POOL_SEED, token_mint_key.as_ref(), &[bump]]];

    {
        let pool = &mut ctx.accounts.pool;
        pool.total_quote_paid_on_sells = pool
            .total_quote_paid_on_sells
            .checked_add(q.net_quote)
            .ok_or(CasaError::MathOverflow)?;
        pool.total_tokens_sold = pool
            .total_tokens_sold
            .checked_add(tokens_in)
            .ok_or(CasaError::MathOverflow)?;
    }

    // 1. Tokens do vendedor → cofre (primeiro o token entra)
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.seller_token_account.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                to: ctx.accounts.token_vault.to_account_info(),
                authority: ctx.accounts.seller.to_account_info(),
            },
        ),
        tokens_in,
        ctx.accounts.token_mint.decimals,
    )?;

    // 2. USDC do cofre → vendedor (depois o dinheiro sai)
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.quote_vault.to_account_info(),
                mint: ctx.accounts.quote_mint.to_account_info(),
                to: ctx.accounts.seller_quote_account.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            },
            signer_seeds,
        ),
        q.net_quote,
        ctx.accounts.quote_mint.decimals,
    )?;

    ctx.accounts.token_vault.reload()?;
    ctx.accounts.quote_vault.reload()?;
    let after = snapshot(
        &ctx.accounts.pool,
        &ctx.accounts.token_mint,
        &ctx.accounts.token_vault,
        &ctx.accounts.quote_vault,
    )?;

    emit!(TokensSold {
        pool: ctx.accounts.pool.key(),
        seller: ctx.accounts.seller.key(),
        tokens_in,
        gross_quote: q.gross_quote,
        fee: q.fee,
        net_quote: q.net_quote,
        price_after: current_price(&after).map_err(math_err)?,
    });
    Ok(())
}
