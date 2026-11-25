use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::spl_token::instruction::AuthorityType;
use anchor_spl::token::{
    self, Mint, MintTo, SetAuthority, Token, TokenAccount, TransferChecked,
};

use crate::errors::{math_err, CasaError};
use crate::events::{MintingCompleted, TokensBought};
use crate::instructions::snapshot;
use crate::math::{current_price, quote_buy};
use crate::state::*;

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

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

    #[account(mut)]
    pub token_mint: Box<Account<'info, Mint>>,
    pub quote_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub token_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub quote_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = quote_mint,
        token::authority = buyer,
    )]
    pub buyer_quote_account: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = token_mint,
        associated_token::authority = buyer,
        associated_token::token_program = token_program,
    )]
    pub buyer_token_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Dinheiro entra, token sai. Na fase 1 o token é cunhado no ato da compra.
pub fn handle_buy(ctx: Context<Buy>, quote_in: u64, min_tokens_out: u64) -> Result<()> {
    require!(!ctx.accounts.pool.paused, CasaError::Paused);

    let snap = snapshot(
        &ctx.accounts.pool,
        &ctx.accounts.token_mint,
        &ctx.accounts.token_vault,
        &ctx.accounts.quote_vault,
    )?;
    let q = quote_buy(&snap, quote_in).map_err(math_err)?;
    require!(q.tokens_out >= min_tokens_out, CasaError::SlippageExceeded);

    let token_mint_key = ctx.accounts.token_mint.key();
    let bump = ctx.accounts.pool.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[POOL_SEED, token_mint_key.as_ref(), &[bump]]];

    // ---- efeitos ----
    {
        let pool = &mut ctx.accounts.pool;
        pool.minted_total = pool.minted_total.checked_add(q.to_mint).ok_or(CasaError::MathOverflow)?;
        pool.total_quote_from_buys = pool
            .total_quote_from_buys
            .checked_add(q.quote_charged)
            .ok_or(CasaError::MathOverflow)?;
        pool.total_tokens_bought = pool
            .total_tokens_bought
            .checked_add(q.tokens_out)
            .ok_or(CasaError::MathOverflow)?;
        if q.completes_minting {
            pool.minting_completed = true;
            pool.minting_completed_at = Clock::get()?.unix_timestamp;
        }
    }

    // ---- interações ----
    // 1. USDC do comprador → cofre
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.buyer_quote_account.to_account_info(),
                mint: ctx.accounts.quote_mint.to_account_info(),
                to: ctx.accounts.quote_vault.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        q.quote_charged,
        ctx.accounts.quote_mint.decimals,
    )?;

    // 2. Estoque do cofre → comprador
    if q.from_inventory > 0 {
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.token_vault.to_account_info(),
                    mint: ctx.accounts.token_mint.to_account_info(),
                    to: ctx.accounts.buyer_token_account.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                signer_seeds,
            ),
            q.from_inventory,
            ctx.accounts.token_mint.decimals,
        )?;
    }

    // 3. Cunhagem sob demanda (somente fase 1)
    if q.to_mint > 0 {
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.token_mint.to_account_info(),
                    to: ctx.accounts.buyer_token_account.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                signer_seeds,
            ),
            q.to_mint,
        )?;
    }

    // 4. Último token cunhado: revoga a autoridade de cunhagem para sempre.
    if q.completes_minting {
        token::set_authority(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                SetAuthority {
                    current_authority: ctx.accounts.pool.to_account_info(),
                    account_or_mint: ctx.accounts.token_mint.to_account_info(),
                },
                signer_seeds,
            ),
            AuthorityType::MintTokens,
            None,
        )?;
    }

    ctx.accounts.token_mint.reload()?;
    ctx.accounts.token_vault.reload()?;
    ctx.accounts.quote_vault.reload()?;
    let after = snapshot(
        &ctx.accounts.pool,
        &ctx.accounts.token_mint,
        &ctx.accounts.token_vault,
        &ctx.accounts.quote_vault,
    )?;
    require!(ctx.accounts.token_mint.supply <= ctx.accounts.pool.max_supply, CasaError::MathOverflow);

    if q.completes_minting {
        emit!(MintingCompleted {
            pool: ctx.accounts.pool.key(),
            token_mint: token_mint_key,
            max_supply: ctx.accounts.pool.max_supply,
            quote_reserve: after.quote_reserve,
            timestamp: ctx.accounts.pool.minting_completed_at,
        });
    }
    emit!(TokensBought {
        pool: ctx.accounts.pool.key(),
        buyer: ctx.accounts.buyer.key(),
        quote_charged: q.quote_charged,
        fee: q.fee,
        tokens_out: q.tokens_out,
        from_inventory: q.from_inventory,
        minted: q.to_mint,
        minted_total: ctx.accounts.pool.minted_total,
        price_after: current_price(&after).map_err(math_err)?,
    });
    Ok(())
}
