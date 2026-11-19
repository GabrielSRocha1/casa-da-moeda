//! inject_daily_profit — repasse de lucro/faturamento da entidade ao lastro.
//! Não cunha tokens e não altera o supply: apenas aumenta o lastro por token.
use crate::constants::*;
use crate::errors::FactoryError;
use crate::events::*;
use crate::math::*;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Mint as SplMint, Token, TokenAccount as SplTokenAccount};

#[derive(Accounts)]
#[instruction(asset: PaymentAsset, amount: u64, reference_id: u64)]
pub struct InjectDailyProfit<'info> {
    /// Remetente autorizado (profit_injector do cofre).
    #[account(mut)]
    pub injector: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, FactoryConfig>>,
    #[account(
        seeds = [SEED_VAULT, &vault.entity_id.to_le_bytes()],
        bump = vault.bump,
        has_one = ledger,
        has_one = sol_treasury,
        has_one = usdc_treasury,
        has_one = revenue_wallet @ FactoryError::InvalidRevenueWallet,
        constraint = vault.profit_injector == injector.key() @ FactoryError::Unauthorized,
    )]
    pub vault: Box<Account<'info, EntityVault>>,
    #[account(
        mut,
        seeds = [SEED_LEDGER, vault.key().as_ref()],
        bump = vault.ledger_bump,
        has_one = vault
    )]
    pub ledger: Box<Account<'info, BackingLedger>>,
    /// Recibo único por `reference_id`: impede a duplicação do mesmo repasse.
    #[account(
        init,
        payer = injector,
        space = 8 + ProfitReceipt::INIT_SPACE,
        seeds = [SEED_PROFIT, vault.key().as_ref(), &reference_id.to_le_bytes()],
        bump
    )]
    pub receipt: Box<Account<'info, ProfitReceipt>>,
    #[account(
        mut,
        seeds = [SEED_SOL_TREASURY, vault.key().as_ref()],
        bump = vault.sol_treasury_bump
    )]
    pub sol_treasury: SystemAccount<'info>,
    #[account(
        mut,
        seeds = [SEED_USDC_TREASURY, vault.key().as_ref()],
        bump = vault.usdc_treasury_bump,
        token::mint = usdc_mint,
        token::authority = vault,
    )]
    pub usdc_treasury: Box<Account<'info, SplTokenAccount>>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<Account<'info, SplMint>>,
    /// Conta USDC do remetente (obrigatória quando asset = Usdc).
    #[account(mut, token::mint = usdc_mint, token::authority = injector)]
    pub injector_usdc_account: Option<Box<Account<'info, SplTokenAccount>>>,
    /// CHECK: carteira de receita autorizada; validada por `has_one` no cofre.
    #[account(mut)]
    pub revenue_wallet: UncheckedAccount<'info>,
    /// Conta USDC da carteira de receita (obrigatória quando asset = Usdc e houver taxa).
    #[account(mut, token::mint = usdc_mint, token::authority = revenue_wallet)]
    pub revenue_usdc_account: Option<Box<Account<'info, SplTokenAccount>>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn inject_daily_profit(
    ctx: Context<InjectDailyProfit>,
    asset: PaymentAsset,
    amount: u64,
    reference_id: u64,
    origin: String,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(!ctx.accounts.config.paused, FactoryError::FactoryPaused);
    ctx.accounts.vault.require_active()?;
    require!(amount > 0, FactoryError::InvalidAmount);
    // Sem tokens existentes o lucro ficaria sem dono e iria inteiro para o próximo comprador.
    require!(ctx.accounts.vault.reference_supply()? > 0, FactoryError::ZeroReferenceSupply);
    check_str(&origin, MAX_ORIGIN_LEN, false)?;

    let fee_bps = if ctx.accounts.vault.charge_fee_on_profit {
        ctx.accounts.vault.platform_fee_bps
    } else {
        0
    };
    let fee = fee_amount(amount, fee_bps)?;
    let net = amount.checked_sub(fee).ok_or(FactoryError::MathOverflow)?;
    require!(net > 0, FactoryError::InvalidAmount);

    match asset {
        PaymentAsset::Sol => {
            require!(
                ctx.accounts.injector.lamports() >= amount,
                FactoryError::InsufficientUserBalance
            );
        }
        PaymentAsset::Usdc => {
            let src = ctx
                .accounts
                .injector_usdc_account
                .as_ref()
                .ok_or(FactoryError::MissingPaymentAccount)?;
            require!(src.amount >= amount, FactoryError::InsufficientUserBalance);
            require!(
                fee == 0 || ctx.accounts.revenue_usdc_account.is_some(),
                FactoryError::MissingPaymentAccount
            );
        }
    }

    let (local_hour, local_weekday) =
        local_hour_and_weekday(now, ctx.accounts.config.ops_utc_offset_secs);
    let within_window = is_recommended_window(local_hour, local_weekday);

    // --- efeitos ---
    let vault_key = ctx.accounts.vault.key();
    let entity_id = ctx.accounts.vault.entity_id;
    {
        let ledger = &mut ctx.accounts.ledger;
        match asset {
            PaymentAsset::Sol => {
                ledger.sol_backing = ledger.sol_backing.checked_add(net).ok_or(FactoryError::MathOverflow)?;
                ledger.sol_profit_injected = ledger.sol_profit_injected.checked_add(net).ok_or(FactoryError::MathOverflow)?;
                ledger.sol_fees_collected = ledger.sol_fees_collected.checked_add(fee).ok_or(FactoryError::MathOverflow)?;
            }
            PaymentAsset::Usdc => {
                ledger.usdc_backing = ledger.usdc_backing.checked_add(net).ok_or(FactoryError::MathOverflow)?;
                ledger.usdc_profit_injected = ledger.usdc_profit_injected.checked_add(net).ok_or(FactoryError::MathOverflow)?;
                ledger.usdc_fees_collected = ledger.usdc_fees_collected.checked_add(fee).ok_or(FactoryError::MathOverflow)?;
            }
        }
        ledger.profit_count = ledger.profit_count.checked_add(1).ok_or(FactoryError::MathOverflow)?;
        ledger.last_operation_ts = now;
    }
    {
        let receipt = &mut ctx.accounts.receipt;
        receipt.vault = vault_key;
        receipt.entity_id = entity_id;
        receipt.reference_id = reference_id;
        receipt.injector = ctx.accounts.injector.key();
        receipt.origin = origin.clone();
        receipt.asset = asset;
        receipt.gross_amount = amount;
        receipt.fee_amount = fee;
        receipt.net_amount = net;
        receipt.timestamp = now;
        receipt.local_hour = local_hour;
        receipt.local_weekday = local_weekday;
        receipt.within_recommended_window = within_window;
        receipt.bump = ctx.bumps.receipt;
    }

    // --- interações ---
    match asset {
        PaymentAsset::Sol => {
            if fee > 0 {
                system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: ctx.accounts.injector.to_account_info(),
                            to: ctx.accounts.revenue_wallet.to_account_info(),
                        },
                    ),
                    fee,
                )?;
            }
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.injector.to_account_info(),
                        to: ctx.accounts.sol_treasury.to_account_info(),
                    },
                ),
                net,
            )?;
        }
        PaymentAsset::Usdc => {
            let src = ctx.accounts.injector_usdc_account.as_ref().ok_or(FactoryError::MissingPaymentAccount)?;
            let decimals = ctx.accounts.usdc_mint.decimals;
            if fee > 0 {
                let revenue_usdc = ctx.accounts.revenue_usdc_account.as_ref().ok_or(FactoryError::MissingPaymentAccount)?;
                token::transfer_checked(
                    CpiContext::new(
                        ctx.accounts.token_program.to_account_info(),
                        token::TransferChecked {
                            from: src.to_account_info(),
                            mint: ctx.accounts.usdc_mint.to_account_info(),
                            to: revenue_usdc.to_account_info(),
                            authority: ctx.accounts.injector.to_account_info(),
                        },
                    ),
                    fee,
                    decimals,
                )?;
            }
            token::transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    token::TransferChecked {
                        from: src.to_account_info(),
                        mint: ctx.accounts.usdc_mint.to_account_info(),
                        to: ctx.accounts.usdc_treasury.to_account_info(),
                        authority: ctx.accounts.injector.to_account_info(),
                    },
                ),
                net,
                decimals,
            )?;
        }
    }

    emit!(ProfitInjected {
        entity_id,
        vault: vault_key,
        injector: ctx.accounts.injector.key(),
        origin,
        reference_id,
        asset,
        gross_amount: amount,
        fee_amount: fee,
        net_amount: net,
        sol_backing: ctx.accounts.ledger.sol_backing,
        usdc_backing: ctx.accounts.ledger.usdc_backing,
        reference_supply: ctx.accounts.vault.reference_supply()?,
        local_hour,
        local_weekday,
        within_recommended_window: within_window,
        timestamp: now,
    });
    if fee > 0 {
        emit!(PlatformFeeCollected {
            entity_id,
            vault: vault_key,
            payer: ctx.accounts.injector.key(),
            revenue_wallet: ctx.accounts.revenue_wallet.key(),
            asset,
            fee_amount: fee,
            fee_bps,
            operation: 2,
            timestamp: now,
        });
    }
    Ok(())
}
