//! buy_tokens — aquisição de tokens com SOL ou USDC (cunhagem elástica com lastro).
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
pub struct BuyTokens<'info> {
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
    /// Conta Token-2022 do comprador para o token da entidade.
    #[account(
        mut,
        token::mint = mint,
        token::authority = user,
        token::token_program = token_2022_program,
    )]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + BuyerRecord::INIT_SPACE,
        seeds = [SEED_BUYER, vault.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub buyer_record: Box<Account<'info, BuyerRecord>>,
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
    /// Conta USDC do comprador (obrigatória quando asset = Usdc).
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

pub fn buy_tokens(
    ctx: Context<BuyTokens>,
    asset: PaymentAsset,
    amount_in: u64,
    min_tokens_out: u64,
    deadline_ts: i64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    // 1-2) Estado do protocolo, ativo de pagamento, origem e destino.
    require!(!ctx.accounts.config.paused, FactoryError::FactoryPaused);
    ctx.accounts.vault.require_active()?;
    require!(!ctx.accounts.vault.minting_closed, FactoryError::MintingClosed);
    require!(deadline_ts == 0 || now <= deadline_ts, FactoryError::DeadlineExceeded);
    require!(amount_in > 0, FactoryError::InvalidAmount);

    match asset {
        PaymentAsset::Sol => {
            require!(
                ctx.accounts.user.lamports() >= amount_in,
                FactoryError::InsufficientUserBalance
            );
        }
        PaymentAsset::Usdc => {
            let user_usdc = ctx
                .accounts
                .user_usdc_account
                .as_ref()
                .ok_or(FactoryError::MissingPaymentAccount)?;
            require!(
                ctx.accounts.revenue_usdc_account.is_some(),
                FactoryError::MissingPaymentAccount
            );
            require!(user_usdc.amount >= amount_in, FactoryError::InsufficientUserBalance);
        }
    }

    // 4) Preço de referência (oráculo validado).
    let prices = load_prices(
        &ctx.accounts.config,
        &ctx.accounts.sol_price_feed.to_account_info(),
        &ctx.accounts.usdc_price_feed.to_account_info(),
        now,
    )?;
    let usdc_decimals = ctx.accounts.usdc_mint.decimals;

    // 5-6) Valor bruto, taxa (uma única cobrança) e valor líquido.
    let fee_bps = ctx.accounts.vault.platform_fee_bps;
    let fee = fee_amount(amount_in, fee_bps)?;
    let net_in = amount_in.checked_sub(fee).ok_or(FactoryError::MathOverflow)?;
    require!(net_in > 0, FactoryError::InvalidAmount);

    // Pagamento avaliado no limite inferior; lastro existente no limite superior.
    let pay_value = match asset {
        PaymentAsset::Sol => value_floor(net_in, SOL_DECIMALS, prices.sol.lo)?,
        PaymentAsset::Usdc => value_floor(net_in, usdc_decimals, prices.usdc.lo)?,
    };
    let ref_supply = ctx.accounts.vault.reference_supply()?;
    let nav_hi = value_ceil(ctx.accounts.ledger.sol_backing, SOL_DECIMALS, prices.sol.hi)?
        .checked_add(value_ceil(
            ctx.accounts.ledger.usdc_backing,
            usdc_decimals,
            prices.usdc.hi,
        )?)
        .ok_or(FactoryError::MathOverflow)?;

    // 9) Quantidade líquida de tokens: pay_value * supply_ref / NAV.
    let tokens_out = if ref_supply == 0 || nav_hi == 0 {
        // Cofre totalmente resgatado: volta ao preço inicial (pool inicial / alocação de vesting).
        let initial_ref = mul_div_floor(
            ctx.accounts.vault.hard_cap as u128,
            VESTING_ALLOCATION_PCT as u128,
            100,
        )?;
        let initial_nav = value_ceil(
            ctx.accounts.vault.initial_pool_amount,
            usdc_decimals,
            prices.usdc.hi,
        )?;
        to_u64(mul_div_floor(pay_value, initial_ref, initial_nav)?)?
    } else {
        to_u64(mul_div_floor(pay_value, ref_supply as u128, nav_hi)?)?
    };

    // 3) Anti-whale + slippage (antes de qualquer movimentação financeira ou cunhagem).
    require!(tokens_out > 0, FactoryError::InvalidAmount);
    require!(tokens_out >= min_tokens_out, FactoryError::SlippageExceeded);
    require!(tokens_out >= ctx.accounts.vault.min_buy, FactoryError::BelowMinBuy);
    require!(tokens_out <= ctx.accounts.vault.max_buy, FactoryError::AboveMaxBuy);

    let balance_after = ctx
        .accounts
        .user_token_account
        .amount
        .checked_add(tokens_out)
        .ok_or(FactoryError::MathOverflow)?;
    require!(
        balance_after <= ctx.accounts.vault.max_wallet,
        FactoryError::MaxWalletExceeded
    );
    let net_acquired_after = ctx
        .accounts
        .buyer_record
        .net_acquired
        .checked_add(tokens_out)
        .ok_or(FactoryError::MathOverflow)?;
    require!(
        net_acquired_after <= ctx.accounts.vault.max_wallet,
        FactoryError::MaxWalletExceeded
    );

    // 10) Hard Cap: circulante + vesting + novos tokens <= hard_cap.
    let new_ref_supply = ref_supply.checked_add(tokens_out).ok_or(FactoryError::MathOverflow)?;
    require!(
        new_ref_supply <= ctx.accounts.vault.hard_cap,
        FactoryError::HardCapExceeded
    );

    // --- efeitos: 7) receita, 8) lastro, supply e controle por carteira ---
    let vault_key = ctx.accounts.vault.key();
    let user_key = ctx.accounts.user.key();
    {
        let ledger = &mut ctx.accounts.ledger;
        match asset {
            PaymentAsset::Sol => {
                ledger.sol_backing = ledger.sol_backing.checked_add(net_in).ok_or(FactoryError::MathOverflow)?;
                ledger.sol_buy_inflow = ledger.sol_buy_inflow.checked_add(net_in).ok_or(FactoryError::MathOverflow)?;
                ledger.sol_fees_collected = ledger.sol_fees_collected.checked_add(fee).ok_or(FactoryError::MathOverflow)?;
            }
            PaymentAsset::Usdc => {
                ledger.usdc_backing = ledger.usdc_backing.checked_add(net_in).ok_or(FactoryError::MathOverflow)?;
                ledger.usdc_buy_inflow = ledger.usdc_buy_inflow.checked_add(net_in).ok_or(FactoryError::MathOverflow)?;
                ledger.usdc_fees_collected = ledger.usdc_fees_collected.checked_add(fee).ok_or(FactoryError::MathOverflow)?;
            }
        }
        ledger.buy_count = ledger.buy_count.checked_add(1).ok_or(FactoryError::MathOverflow)?;
        ledger.last_operation_ts = now;
    }
    {
        let vault = &mut ctx.accounts.vault;
        vault.circulating_supply = vault.circulating_supply.checked_add(tokens_out).ok_or(FactoryError::MathOverflow)?;
        vault.total_minted = vault.total_minted.checked_add(tokens_out).ok_or(FactoryError::MathOverflow)?;
    }
    {
        let record = &mut ctx.accounts.buyer_record;
        if record.buyer == Pubkey::default() {
            record.vault = vault_key;
            record.buyer = user_key;
            record.bump = ctx.bumps.buyer_record;
        }
        require_keys_eq!(record.vault, vault_key, FactoryError::Unauthorized);
        require_keys_eq!(record.buyer, user_key, FactoryError::Unauthorized);
        record.total_purchased = record.total_purchased.checked_add(tokens_out).ok_or(FactoryError::MathOverflow)?;
        record.net_acquired = net_acquired_after;
        record.purchase_count = record.purchase_count.checked_add(1).ok_or(FactoryError::MathOverflow)?;
        record.last_purchase_ts = now;
    }

    // --- interações (atômicas: qualquer falha reverte tudo) ---
    match asset {
        PaymentAsset::Sol => {
            if fee > 0 {
                system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: ctx.accounts.user.to_account_info(),
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
                        from: ctx.accounts.user.to_account_info(),
                        to: ctx.accounts.sol_treasury.to_account_info(),
                    },
                ),
                net_in,
            )?;
        }
        PaymentAsset::Usdc => {
            let user_usdc = ctx.accounts.user_usdc_account.as_ref().ok_or(FactoryError::MissingPaymentAccount)?;
            let revenue_usdc = ctx.accounts.revenue_usdc_account.as_ref().ok_or(FactoryError::MissingPaymentAccount)?;
            if fee > 0 {
                token::transfer_checked(
                    CpiContext::new(
                        ctx.accounts.token_program.to_account_info(),
                        token::TransferChecked {
                            from: user_usdc.to_account_info(),
                            mint: ctx.accounts.usdc_mint.to_account_info(),
                            to: revenue_usdc.to_account_info(),
                            authority: ctx.accounts.user.to_account_info(),
                        },
                    ),
                    fee,
                    usdc_decimals,
                )?;
            }
            token::transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    token::TransferChecked {
                        from: user_usdc.to_account_info(),
                        mint: ctx.accounts.usdc_mint.to_account_info(),
                        to: ctx.accounts.usdc_treasury.to_account_info(),
                        authority: ctx.accounts.user.to_account_info(),
                    },
                ),
                net_in,
                usdc_decimals,
            )?;
        }
    }

    // 11) Cunhagem Token-2022 para o comprador, assinada pelo PDA do cofre.
    let entity_id = ctx.accounts.vault.entity_id;
    let entity_id_bytes = entity_id.to_le_bytes();
    let vault_bump = [ctx.accounts.vault.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[SEED_VAULT, &entity_id_bytes, &vault_bump]];
    token_2022::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_2022_program.to_account_info(),
            token_2022::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ),
        tokens_out,
    )?;

    // 12) Eventos.
    emit!(TokenPurchased {
        entity_id,
        vault: vault_key,
        buyer: user_key,
        asset,
        gross_amount: amount_in,
        fee_amount: fee,
        net_amount: net_in,
        tokens_minted: tokens_out,
        circulating_supply: ctx.accounts.vault.circulating_supply,
        reference_supply: new_ref_supply,
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
        operation: 0,
        timestamp: now,
    });
    if new_ref_supply == ctx.accounts.vault.hard_cap {
        emit!(HardCapReached {
            entity_id,
            vault: vault_key,
            hard_cap: ctx.accounts.vault.hard_cap,
            circulating_supply: ctx.accounts.vault.circulating_supply,
            vesting_locked_supply: ctx.accounts.vault.vesting_locked_supply,
            timestamp: now,
        });
    }
    Ok(())
}
