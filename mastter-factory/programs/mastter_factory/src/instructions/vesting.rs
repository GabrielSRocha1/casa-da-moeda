//! claim_vested_tokens — liberação do vesting de 30% exclusivamente para a Verum Wallet.
use crate::constants::*;
use crate::errors::FactoryError;
use crate::events::*;
use crate::math::*;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, Token2022};
use anchor_spl::token_interface::{Mint, TokenAccount};

#[derive(Accounts)]
pub struct ClaimVestedTokens<'info> {
    /// A própria Verum Wallet cadastrada deve assinar.
    #[account(address = vault.verum_wallet @ FactoryError::Unauthorized)]
    pub beneficiary: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, FactoryConfig>>,
    #[account(
        mut,
        seeds = [SEED_VAULT, &vault.entity_id.to_le_bytes()],
        bump = vault.bump,
        has_one = mint,
        has_one = vesting,
        has_one = ledger,
    )]
    pub vault: Box<Account<'info, EntityVault>>,
    #[account(
        mut,
        seeds = [SEED_LEDGER, vault.key().as_ref()],
        bump = vault.ledger_bump,
        has_one = vault
    )]
    pub ledger: Box<Account<'info, BackingLedger>>,
    #[account(
        mut,
        seeds = [SEED_VESTING, vault.key().as_ref()],
        bump = vesting.bump,
        has_one = vault,
        has_one = mint,
        has_one = escrow,
        has_one = beneficiary @ FactoryError::Unauthorized,
    )]
    pub vesting: Box<Account<'info, VestingAccount>>,
    #[account(
        mut,
        seeds = [SEED_VESTING_ESCROW, vault.key().as_ref()],
        bump = vault.vesting_escrow_bump,
        token::mint = mint,
        token::authority = vault,
        token::token_program = token_2022_program,
    )]
    pub escrow: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mint::token_program = token_2022_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    /// Conta Token-2022 de destino: obrigatoriamente de propriedade da Verum Wallet.
    #[account(
        mut,
        token::mint = mint,
        token::authority = beneficiary,
        token::token_program = token_2022_program,
    )]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_2022_program: Program<'info, Token2022>,
}

pub fn claim_vested_tokens(ctx: Context<ClaimVestedTokens>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(!ctx.accounts.config.paused, FactoryError::FactoryPaused);
    ctx.accounts.vault.require_active()?;

    let vesting = &ctx.accounts.vesting;
    require!(now >= vesting.cliff_ts, FactoryError::VestingCliffNotReached);

    let vested_total = vested_amount(vesting.total_allocated, vesting.cliff_ts, vesting.end_ts, now)?;
    let claimable = vested_total.checked_sub(vesting.released).ok_or(FactoryError::MathOverflow)?;
    require!(claimable > 0, FactoryError::NothingToClaim);
    require!(
        ctx.accounts.escrow.amount >= claimable,
        FactoryError::InsufficientTreasuryBalance
    );

    // --- efeitos ---
    {
        let vesting = &mut ctx.accounts.vesting;
        vesting.released = vesting.released.checked_add(claimable).ok_or(FactoryError::MathOverflow)?;
        vesting.remaining = vesting.total_allocated.checked_sub(vesting.released).ok_or(FactoryError::MathOverflow)?;
        vesting.last_claim_ts = now;
    }
    {
        let vault = &mut ctx.accounts.vault;
        vault.vesting_locked_supply = vault.vesting_locked_supply.checked_sub(claimable).ok_or(FactoryError::MathOverflow)?;
        vault.circulating_supply = vault.circulating_supply.checked_add(claimable).ok_or(FactoryError::MathOverflow)?;
    }
    {
        let ledger = &mut ctx.accounts.ledger;
        ledger.claim_count = ledger.claim_count.checked_add(1).ok_or(FactoryError::MathOverflow)?;
        ledger.last_operation_ts = now;
    }

    // --- interação: escrow -> conta da Verum Wallet ---
    let entity_id = ctx.accounts.vault.entity_id;
    let entity_id_bytes = entity_id.to_le_bytes();
    let vault_bump = [ctx.accounts.vault.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[SEED_VAULT, &entity_id_bytes, &vault_bump]];
    token_2022::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_2022_program.to_account_info(),
            token_2022::TransferChecked {
                from: ctx.accounts.escrow.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ),
        claimable,
        ctx.accounts.mint.decimals,
    )?;

    emit!(VestedTokensClaimed {
        entity_id,
        vault: ctx.accounts.vault.key(),
        beneficiary: ctx.accounts.beneficiary.key(),
        destination: ctx.accounts.destination.key(),
        amount: claimable,
        total_released: ctx.accounts.vesting.released,
        remaining: ctx.accounts.vesting.remaining,
        timestamp: now,
    });
    Ok(())
}
