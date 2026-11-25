use anchor_lang::prelude::*;

#[event]
pub struct PoolInitialized {
    pub pool: Pubkey,
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub max_supply: u64,
    pub initial_price: u64,
    pub buy_fee_bps: u16,
    pub sell_fee_bps: u16,
}

#[event]
pub struct TokensBought {
    pub pool: Pubkey,
    pub buyer: Pubkey,
    pub quote_charged: u64,
    pub fee: u64,
    pub tokens_out: u64,
    pub from_inventory: u64,
    pub minted: u64,
    pub minted_total: u64,
    pub price_after: u64,
}

#[event]
pub struct TokensSold {
    pub pool: Pubkey,
    pub seller: Pubkey,
    pub tokens_in: u64,
    pub gross_quote: u64,
    pub fee: u64,
    pub net_quote: u64,
    pub price_after: u64,
}

#[event]
pub struct QuoteInjected {
    pub pool: Pubkey,
    pub depositor: Pubkey,
    pub reference: [u8; 32],
    pub amount: u64,
    pub index: u64,
    pub during_capitalization: bool,
    pub price_after: u64,
}

/// Transição de fase: último token cunhado, autoridade de cunhagem revogada.
#[event]
pub struct MintingCompleted {
    pub pool: Pubkey,
    pub token_mint: Pubkey,
    pub max_supply: u64,
    pub quote_reserve: u64,
    pub timestamp: i64,
}

#[event]
pub struct PausedChanged {
    pub pool: Pubkey,
    pub paused: bool,
}

#[event]
pub struct AuthorityProposed {
    pub pool: Pubkey,
    pub current: Pubkey,
    pub proposed: Pubkey,
}

#[event]
pub struct AuthorityTransferred {
    pub pool: Pubkey,
    pub previous: Pubkey,
    pub new_authority: Pubkey,
}
