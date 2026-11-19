//! Mastter.Digital — Smart Contract Mãe (Factory Pattern) multissetorial.
//!
//! Cada entidade recebe um conjunto isolado de PDAs: EntityVault, Token Mint
//! (SPL Token-2022), cofres SOL/USDC, BackingLedger, VestingAccount e RegistryData.
#![allow(clippy::result_large_err)]

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod oracle;
pub mod state;

use instructions::*;
use state::PaymentAsset;

declare_id!("FZ4dYHSvFs9eF1TnN9QLj5XUuhD3yWqM1us9itqjhrE9");

#[program]
pub mod mastter_factory {
    use super::*;

    /// Cria a configuração global. Somente a upgrade authority do programa.
    pub fn initialize_factory(ctx: Context<InitializeFactory>, args: InitializeFactoryArgs) -> Result<()> {
        instructions::admin::initialize_factory(ctx, args)
    }

    /// Atualiza oráculo, limites e carteira de receita padrão.
    pub fn update_factory_config(ctx: Context<UpdateFactoryConfig>, args: UpdateFactoryConfigArgs) -> Result<()> {
        instructions::admin::update_factory_config(ctx, args)
    }

    /// Pausa/retoma todos os cofres.
    pub fn set_factory_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        instructions::admin::set_factory_paused(ctx, paused)
    }

    /// Transferência de administração em dois passos (1/2).
    pub fn propose_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        instructions::admin::propose_admin(ctx, new_admin)
    }

    /// Transferência de administração em dois passos (2/2).
    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        instructions::admin::accept_admin(ctx)
    }

    /// Cadastra a entidade: EntityVault + RegistryData + BackingLedger.
    pub fn initialize_entity_vault(ctx: Context<InitializeEntityVault>, args: InitializeEntityVaultArgs) -> Result<()> {
        instructions::entity::initialize_entity_vault(ctx, args)
    }

    /// Ativa o cofre: Mint Token-2022, cofres SOL/USDC, vesting de 30% e lastro inicial.
    /// Nome, símbolo, URI e hash da imagem ficam imutáveis a partir daqui.
    pub fn activate_entity_vault(
        ctx: Context<ActivateEntityVault>,
        token_uri: String,
        image_sha256: [u8; 32],
    ) -> Result<()> {
        instructions::entity::activate_entity_vault(ctx, token_uri, image_sha256)
    }

    /// Ajusta anti-whale, taxa, remetente de lucro e carteira de receita do cofre.
    pub fn update_entity_config(ctx: Context<UpdateEntityConfig>, args: UpdateEntityConfigArgs) -> Result<()> {
        instructions::entity::update_entity_config(ctx, args)
    }

    /// Pausa/retoma um cofre específico.
    pub fn set_vault_paused(ctx: Context<VaultAdmin>, paused: bool) -> Result<()> {
        instructions::entity::set_vault_paused(ctx, paused)
    }

    /// Atualiza os dados cadastrais (RegistryData).
    pub fn update_registry_data(ctx: Context<UpdateRegistryData>, args: UpdateRegistryArgs) -> Result<()> {
        instructions::entity::update_registry_data(ctx, args)
    }

    /// IRREVERSÍVEL: revoga a Mint Authority do token da entidade.
    pub fn close_minting(ctx: Context<CloseMinting>, confirm: bool) -> Result<()> {
        instructions::entity::close_minting(ctx, confirm)
    }

    /// Compra de tokens com SOL ou USDC.
    pub fn buy_tokens(
        ctx: Context<BuyTokens>,
        asset: PaymentAsset,
        amount_in: u64,
        min_tokens_out: u64,
        deadline_ts: i64,
    ) -> Result<()> {
        instructions::buy::buy_tokens(ctx, asset, amount_in, min_tokens_out, deadline_ts)
    }

    /// Resgate: queima tokens e paga o valor proporcional em SOL ou USDC.
    pub fn sell_tokens(
        ctx: Context<SellTokens>,
        asset: PaymentAsset,
        token_amount: u64,
        min_amount_out: u64,
        deadline_ts: i64,
    ) -> Result<()> {
        instructions::sell::sell_tokens(ctx, asset, token_amount, min_amount_out, deadline_ts)
    }

    /// Injeção de lucro/faturamento no lastro (sem cunhagem).
    pub fn inject_daily_profit(
        ctx: Context<InjectDailyProfit>,
        asset: PaymentAsset,
        amount: u64,
        reference_id: u64,
        origin: String,
    ) -> Result<()> {
        instructions::profit::inject_daily_profit(ctx, asset, amount, reference_id, origin)
    }

    /// Saque dos tokens liberados pelo vesting para a Verum Wallet.
    pub fn claim_vested_tokens(ctx: Context<ClaimVestedTokens>) -> Result<()> {
        instructions::vesting::claim_vested_tokens(ctx)
    }

    /// Emite um retrato contábil do cofre (NAV, preço, segregações).
    pub fn emit_vault_snapshot(ctx: Context<EmitVaultSnapshot>) -> Result<()> {
        instructions::snapshot::emit_vault_snapshot(ctx)
    }
}
