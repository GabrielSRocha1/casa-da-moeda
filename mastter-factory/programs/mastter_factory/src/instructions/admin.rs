use anchor_lang::prelude::*;

use crate::errors::CasaError;
use crate::events::{AuthorityProposed, AuthorityTransferred, PausedChanged};
use crate::state::Pool;

/// Poderes administrativos (e só estes): pausar compras/injeções e transferir a
/// administração. Não há instrução para sacar fundos, alterar preço, taxa ou supply.
#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority)]
    pub pool: Box<Account<'info, Pool>>,
}

#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    pub new_authority: Signer<'info>,
    #[account(mut)]
    pub pool: Box<Account<'info, Pool>>,
}

pub fn handle_set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
    ctx.accounts.pool.paused = paused;
    emit!(PausedChanged { pool: ctx.accounts.pool.key(), paused });
    Ok(())
}

pub fn handle_propose_authority(ctx: Context<AdminOnly>, new_authority: Pubkey) -> Result<()> {
    require_keys_neq!(new_authority, Pubkey::default(), CasaError::InvalidAddress);
    ctx.accounts.pool.pending_authority = new_authority;
    emit!(AuthorityProposed {
        pool: ctx.accounts.pool.key(),
        current: ctx.accounts.pool.authority,
        proposed: new_authority,
    });
    Ok(())
}

pub fn handle_accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    require_keys_eq!(
        pool.pending_authority,
        ctx.accounts.new_authority.key(),
        CasaError::NotPendingAuthority
    );
    let previous = pool.authority;
    pool.authority = ctx.accounts.new_authority.key();
    pool.pending_authority = Pubkey::default();
    emit!(AuthorityTransferred { pool: pool.key(), previous, new_authority: pool.authority });
    Ok(())
}
