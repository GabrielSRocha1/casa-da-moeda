use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::errors::{math_err, CasaError};
use crate::events::QuoteInjected;
use crate::instructions::snapshot;
use crate::math::current_price;
use crate::state::*;

#[derive(Accounts)]
#[instruction(amount: u64, reference: [u8; 32])]
pub struct InjectQuote<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

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
    pub token_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub quote_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = quote_mint,
        token::authority = depositor,
    )]
    pub depositor_quote_account: Box<Account<'info, TokenAccount>>,

    /// `init` falha se a referência já existir → impede depósito duplicado.
    #[account(
        init,
        payer = depositor,
        space = 8 + DepositRecord::INIT_SPACE,
        seeds = [DEPOSIT_SEED, pool.key().as_ref(), reference.as_ref()],
        bump
    )]
    pub deposit_record: Box<Account<'info, DepositRecord>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Deposita USDC no cofre SEM entregar nem cunhar nenhum token.
/// Na fase 1 o preço fica fixo; na fase 2 o depósito eleva o preço do token.
pub fn handle_inject_quote(ctx: Context<InjectQuote>, amount: u64, reference: [u8; 32]) -> Result<()> {
    require!(!ctx.accounts.pool.paused, CasaError::Paused);
    require!(amount > 0, CasaError::ZeroAmount);

    let clock = Clock::get()?;
    let index = ctx.accounts.pool.deposit_count;
    let during_capitalization = ctx.accounts.pool.minting_completed;

    {
        let pool = &mut ctx.accounts.pool;
        pool.deposit_count = pool.deposit_count.checked_add(1).ok_or(CasaError::MathOverflow)?;
        pool.total_quote_injected = pool
            .total_quote_injected
            .checked_add(amount)
            .ok_or(CasaError::MathOverflow)?;
    }
    {
        let rec = &mut ctx.accounts.deposit_record;
        rec.pool = ctx.accounts.pool.key();
        rec.depositor = ctx.accounts.depositor.key();
        rec.reference = reference;
        rec.amount = amount;
        rec.index = index;
        rec.slot = clock.slot;
        rec.timestamp = clock.unix_timestamp;
        rec.during_capitalization = during_capitalization;
        rec.bump = ctx.bumps.deposit_record;
    }

    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.depositor_quote_account.to_account_info(),
                mint: ctx.accounts.quote_mint.to_account_info(),
                to: ctx.accounts.quote_vault.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.quote_mint.decimals,
    )?;

    ctx.accounts.quote_vault.reload()?;
    let after = snapshot(
        &ctx.accounts.pool,
        &ctx.accounts.token_mint,
        &ctx.accounts.token_vault,
        &ctx.accounts.quote_vault,
    )?;
    emit!(QuoteInjected {
        pool: ctx.accounts.pool.key(),
        depositor: ctx.accounts.depositor.key(),
        reference,
        amount,
        index,
        during_capitalization,
        price_after: current_price(&after).map_err(math_err)?,
    });
    Ok(())
}
