use anchor_lang::prelude::*;

use crate::math::MathError;

#[error_code]
pub enum CasaError {
    #[msg("Valor deve ser maior que zero")]
    ZeroAmount,
    #[msg("Operação resultaria em zero")]
    ZeroOutput,
    #[msg("Estouro aritmético")]
    MathOverflow,
    #[msg("Decimais do token inválidos (máximo 9)")]
    InvalidDecimals,
    #[msg("Supply máximo inválido")]
    InvalidMaxSupply,
    #[msg("Preço inicial inválido")]
    InvalidPrice,
    #[msg("Taxa acima do limite (máximo 10%)")]
    InvalidFee,
    #[msg("Token e moeda de cotação não podem ser iguais")]
    SameMint,
    #[msg("Compras e injeções pausadas")]
    Paused,
    #[msg("Slippage excedido")]
    SlippageExceeded,
    #[msg("Estoque de tokens do cofre insuficiente")]
    InsufficientInventory,
    #[msg("Reserva de USDC insuficiente")]
    InsufficientReserve,
    #[msg("Todos os tokens já foram cunhados e estão em circulação")]
    SoldOut,
    #[msg("Não há transferência de administração pendente para esta conta")]
    NotPendingAuthority,
    #[msg("Endereço inválido")]
    InvalidAddress,
}

impl From<MathError> for CasaError {
    fn from(e: MathError) -> Self {
        match e {
            MathError::Overflow => CasaError::MathOverflow,
            MathError::ZeroAmount => CasaError::ZeroAmount,
            MathError::ZeroOutput => CasaError::ZeroOutput,
            MathError::InsufficientInventory => CasaError::InsufficientInventory,
            MathError::InsufficientReserve => CasaError::InsufficientReserve,
            MathError::SoldOut => CasaError::SoldOut,
        }
    }
}

pub fn math_err(e: MathError) -> anchor_lang::error::Error {
    CasaError::from(e).into()
}
