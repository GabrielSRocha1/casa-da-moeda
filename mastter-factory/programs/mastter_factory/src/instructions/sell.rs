//! sell_tokens — resgate: queima dos tokens e pagamento proporcional ao lastro.
use crate::constants::*;
use crate::errors::FactoryError;
use crate::events::*;
use crate::math::*;
use crate::oracle::load_prices;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Mint as SplMint, Token, TokenAccount as SplTokenAccount};
use anchor_spl::token_2022::{self, Token2022};
use anchor_spl::token_interface::{Mint, TokenAccount};

#[derive(Accounts)]
pub struct SellTokens<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, FactoryConfig>>,
    #[account(
        mut,
        seeds = [SEED_VAULT, &vault.entity_id.to_le_bytes()],
        bump = vault.bump,
        has_one = mint,
        has_one = ledger,
        has_one = sol_treasury,
        has_one = usdc_treasury,
        has_one = revenue_wallet @ FactoryError::InvalidRevenueWallet,
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
        seeds = [SEED_MINT, vault.key().as_ref()],
        bump = vault.mint_bump,
        mint::token_program = token_2022_program,
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = user,
        token::token_program = token_2022_program,
    )]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Registro de compras do usuário (opcional; reduz `net_acquired` no resgate).
    #[account(
        mut,
        seeds = [SEED_BUYER, vault.key().as_ref(), user.key().as_ref()],
        bump = buyer_record.bump,
    )]
    pub buyer_record: Option<Box<Account<'info, BuyerRecord>>>,
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
    /// Conta USDC do usuário (obrigatória quando asset = Usdc).
    #[account(mut, token::mint = usdc_mint, token::authority = user)]
    pub user_usdc_account: Option<Box<Account<'info, SplTokenAccount>>>,
    /// CHECK: carteira de receita autorizada; validada por `has_one` no cofre.
    #[account(mut)]
    pub revenue_wallet: UncheckedAccount<'info>,
    /// Conta USDC da carteira de receita (obrigatória quando asset = Usdc).
    #[account(mut, token::mint = usdc_mint, token::authority = revenue_wallet)]
    pub revenue_usdc_account: Option<Box<Account<'info, SplTokenAccount>>>,
    /// CHECK: conta de preço SOL/USD; endereço fixado na Factory e conteúdo validado em `oracle::load_price`.
    #[account(address = config.sol_price_account @ FactoryError::InvalidOracleAccount)]
    pub sol_price_feed: UncheckedAccount<'info>,
    /// CHECK: conta de preço USDC/USD; endereço fixado na Factory e conteúdo validado em `oracle::load_price`.
    #[account(address = config.usdc_price_account @ FactoryError::InvalidOracleAccount)]
    pub usdc_price_feed: UncheckedAccount<'info>,
    pub token_2022_program: Program<'info, Token2022>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn sell_tokens(
    ctx: Context<SellTokens>,
    asset: PaymentAsset,
    token_amount: u64,
    min_amount_out: u64,
    deadline_ts: i64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    // 1-2) Usuário, conta de tokens e quantidade disponível.
    require!(!ctx.accounts.config.paused, FactoryError::FactoryPaused);
    ctx.accounts.vault.require_active()?;
    require!(deadline_ts == 0 || now <= deadline_ts, FactoryError::DeadlineExceeded);
    require!(token_amount > 0, FactoryError::InvalidAmount);
    require!(
        ctx.accounts.user_token_account.amount >= token_amount,
        FactoryError::InsufficientUserBalance
    );
    require!(
        ctx.accounts.vault.circulating_supply >= token_amount,
        FactoryError::InsufficientUserBalance
    );
    if asset == PaymentAsset::Usdc {
        require!(
            ctx.accounts.user_usdc_account.is_some() && ctx.accounts.revenue_usdc_account.is_some(),
            FactoryError::MissingPaymentAccount
        );
    }

    let prices = load_prices(
        &ctx.accounts.config,
        &ctx.accounts.sol_price_feed.to_account_info(),
        &ctx.accounts.usdc_price_feed.to_account_info(),
        now,
    )?;
    let usdc_decimals = ctx.accounts.usdc_mint.decimals;

    // 3) Valor bruto de resgate: lastro no limite inferior, ativo pago no limite superior.
    let ref_supply = ctx.accounts.vault.reference_supply()?;
    require!(ref_supply > 0, FactoryError::ZeroReferenceSupply);
    let nav_lo = value_floor(ctx.accounts.ledger.sol_backing, SOL_DECIMALS, prices.sol.lo)?
        .checked_add(value_floor(
            ctx.accounts.ledger.usdc_backing,
            usdc_decimals,
            prices.usdc.lo,
        )?)
        .ok_or(FactoryError::MathOverflow)?;
    let gross_value = mul_div_floor(token_amount as u128, nav_lo, ref_supply as u128)?;
    let gross_out = match asset {
        PaymentAsset::Sol => to_u64(mul_div_floor(gross_value, pow10(SOL_DECIMALS as u32)?, prices.sol.hi)?)?,
        PaymentAsset::Usdc => to_u64(mul_div_floor(gross_value, pow10(usdc_decimals as u32)?, prices.usdc.hi)?)?,
    };
    require!(gross_out > 0, FactoryError::InvalidAmount);

    // Nunca liberar mais do que o lastro contabilizado E o saldo real do cofre.
    match asset {
        PaymentAsset::Sol => {
            require!(
                gross_out <= ctx.accounts.ledger.sol_backing,
                FactoryError::InsufficientLiquidity
            );
            let rent_min = Rent::get()?.minimum_balance(0);
            let free = ctx.accounts.sol_treasury.lamports().saturating_sub(rent_min);
            require!(gross_out <= free, FactoryError::InsufficientTreasuryBalance);
        }
        PaymentAsset::Usdc => {
            require!(
                gross_out <= ctx.accounts.ledger.usdc_backing,
                FactoryError::InsufficientLiquidity
            );
            require!(
                gross_out <= ctx.accounts.usdc_treasury.amount,
                FactoryError::InsufficientTreasuryBalance
            );
        }
    }

    // 4) Taxa de serviço (uma única cobrança) e slippage.
    let fee_bps = ctx.accounts.vault.platform_fee_bps;
    let fee = fee_amount(gross_out, fee_bps)?;
    let net_out = gross_out.checked_sub(fee).ok_or(FactoryError::MathOverflow)?;
    require!(net_out >= min_amount_out, FactoryError::SlippageExceeded);

    // --- efeitos: 6) supply, 7) lastro, 9) taxa ---
    let vault_key = ctx.accounts.vault.key();
    let user_key = ctx.accounts.user.key();
    {
        let vault = &mut ctx.accounts.vault;
        vault.circulating_supply = vault.circulating_supply.checked_sub(token_amount).ok_or(FactoryError::MathOverflow)?;
        vault.total_burned = vault.total_burned.checked_add(token_amount).ok_or(FactoryError::MathOverflow)?;
    }
    {
        let ledger = &mut ctx.accounts.ledger;
        match asset {
            PaymentAsset::Sol => {
                ledger.sol_backing = ledger.sol_backing.checked_sub(gross_out).ok_or(FactoryError::MathOverflow)?;
                ledger.sol_redeemed = ledger.sol_redeemed.checked_add(gross_out).ok_or(FactoryError::MathOverflow)?;
                ledger.sol_fees_collected = ledger.sol_fees_collected.checked_add(fee).ok_or(FactoryError::MathOverflow)?;
            }
            PaymentAsset::Usdc => {
                ledger.usdc_backing = ledger.usdc_backing.checked_sub(gross_out).ok_or(FactoryError::MathOverflow)?;
                ledger.usdc_redeemed = ledger.usdc_redeemed.checked_add(gross_out).ok_or(FactoryError::MathOverflow)?;
                ledger.usdc_fees_collected = ledger.usdc_fees_collected.checked_add(fee).ok_or(FactoryError::MathOverflow)?;
            }
        }
        ledger.sell_count = ledger.sell_count.checked_add(1).ok_or(FactoryError::MathOverflow)?;
        ledger.last_operation_ts = now;
    }
    if let Some(record) = ctx.accounts.buyer_record.as_mut() {
        require_keys_eq!(record.vault, vault_key, FactoryError::Unauthorized);
        require_keys_eq!(record.buyer, user_key, FactoryError::Unauthorized);
        record.total_sold = record.total_sold.checked_add(token_amount).ok_or(FactoryError::MathOverflow)?;
        record.net_acquired = record.net_acquired.saturating_sub(token_amount);
    }

    // --- interações ---
    // 5) Queima dos tokens do usuário.
    token_2022::burn(
        CpiContext::new(
            ctx.accounts.token_2022_program.to_account_info(),
            token_2022::Burn {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        token_amount,
    )?;

    // 8-9) Pagamento líquido ao usuário e taxa à carteira de receita.
    let entity_id = ctx.accounts.vault.entity_id;
    match asset {
        PaymentAsset::Sol => {
            let bump = [ctx.accounts.vault.sol_treasury_bump];
            let seeds: &[&[&[u8]]] = &[&[SEED_SOL_TREASURY, vault_key.as_ref(), &bump]];
            if net_out > 0 {
                system_program::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: ctx.accounts.sol_treasury.to_account_info(),
                            to: ctx.accounts.user.to_account_info(),
                        },
                        seeds,
                    ),
                    net_out,
                )?;
            }
            if fee > 0 {
                system_program::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: ctx.accounts.sol_treasury.to_account_info(),
                            to: ctx.accounts.revenue_wallet.to_account_info(),
                        },
                        seeds,
                    ),
                    fee,
                )?;
            }
        }
        PaymentAsset::Usdc => {
            let entity_id_bytes = entity_id.to_le_bytes();
            let vault_bump = [ctx.accounts.vault.bump];
            let seeds: &[&[&[u8]]] = &[&[SEED_VAULT, &entity_id_bytes, &vault_bump]];
            let user_usdc = ctx.accounts.user_usdc_account.as_ref().ok_or(FactoryError::MissingPaymentAccount)?;
            let revenue_usdc = ctx.accounts.revenue_usdc_account.as_ref().ok_or(FactoryError::MissingPaymentAccount)?;
            if net_out > 0 {
                token::transfer_checked(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        token::TransferChecked {
                            from: ctx.accounts.usdc_treasury.to_account_info(),
                            mint: ctx.accounts.usdc_mint.to_account_info(),
                            to: user_usdc.to_account_info(),
                            authority: ctx.accounts.vault.to_account_info(),
                        },
                        seeds,
                    ),
                    net_out,
                    usdc_decimals,
                )?;
            }
            if fee > 0 {
                token::transfer_checked(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        token::TransferChecked {
                            from: ctx.accounts.usdc_treasury.to_account_info(),
                            mint: ctx.accounts.usdc_mint.to_account_info(),
                            to: revenue_usdc.to_account_info(),
                            authority: ctx.accounts.vault.to_account_info(),
                        },
                        seeds,
                    ),
                    fee,
                    usdc_decimals,
                )?;
            }
        }
    }

    // 10) Eventos.
    emit!(TokenRedeemed {
        entity_id,
        vault: vault_key,
        seller: user_key,
        asset,
        tokens_burned: token_amount,
        gross_amount: gross_out,
        fee_amount: fee,
        net_amount: net_out,
        circulating_supply: ctx.accounts.vault.circulating_supply,
        reference_supply: ctx.accounts.vault.reference_supply()?,
        sol_backing: ctx.accounts.ledger.sol_backing,
        usdc_backing: ctx.accounts.ledger.usdc_backing,
        timestamp: now,
    });
    emit!(PlatformFeeCollected {
        entity_id,
        vault: vault_key,
        payer: user_key,
        revenue_wallet: ctx.accounts.revenue_wallet.key(),
        asset,
        fee_amount: fee,
        fee_bps,
        operation: 1,
        timestamp: now,
    });
    Ok(())
}
