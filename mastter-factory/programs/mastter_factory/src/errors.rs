use anchor_lang::prelude::*;

#[error_code]
pub enum FactoryError {
    #[msg("Assinante não autorizado para esta operação")]
    Unauthorized,
    #[msg("Somente a upgrade authority do programa pode inicializar a Factory")]
    NotUpgradeAuthority,
    #[msg("Conta ProgramData inválida")]
    InvalidProgramData,
    #[msg("Factory pausada")]
    FactoryPaused,
    #[msg("Cofre não está ativo")]
    VaultNotActive,
    #[msg("Cofre já foi ativado ou está em estado inválido para esta operação")]
    InvalidVaultStatus,
    #[msg("Hard Cap inválido: use 25.000.000, 50.000.000 ou 100.000.000")]
    InvalidHardCap,
    #[msg("Decimais inválidos (máximo 9)")]
    InvalidDecimals,
    #[msg("String vazia ou acima do tamanho máximo permitido")]
    InvalidStringLength,
    #[msg("Parâmetros anti-whale inconsistentes")]
    InvalidAntiWhaleParams,
    #[msg("Taxa de plataforma acima do teto permitido")]
    InvalidFee,
    #[msg("Valor inválido (zero ou fora dos limites)")]
    InvalidAmount,
    #[msg("Verum Wallet inválida")]
    InvalidVerumWallet,
    #[msg("Carteira de receita inválida")]
    InvalidRevenueWallet,
    #[msg("Compra abaixo do mínimo por transação")]
    BelowMinBuy,
    #[msg("Compra acima do máximo por transação")]
    AboveMaxBuy,
    #[msg("Limite máximo de tokens por carteira excedido")]
    MaxWalletExceeded,
    #[msg("Hard Cap excedido")]
    HardCapExceeded,
    #[msg("Cunhagem encerrada: Mint Authority revogada")]
    MintingClosed,
    #[msg("Slippage excedido")]
    SlippageExceeded,
    #[msg("Prazo da transação expirado")]
    DeadlineExceeded,
    #[msg("Saldo insuficiente do usuário")]
    InsufficientUserBalance,
    #[msg("Lastro contabilizado insuficiente neste ativo para o resgate")]
    InsufficientLiquidity,
    #[msg("Saldo real do cofre insuficiente")]
    InsufficientTreasuryBalance,
    #[msg("Conta do ativo de pagamento ausente")]
    MissingPaymentAccount,
    #[msg("Overflow/underflow aritmético")]
    MathOverflow,
    #[msg("Conta de oráculo inválida")]
    InvalidOracleAccount,
    #[msg("Feed de preço não corresponde ao configurado")]
    OracleFeedMismatch,
    #[msg("Preço do oráculo desatualizado")]
    StaleOraclePrice,
    #[msg("Preço do oráculo inválido (não positivo)")]
    InvalidOraclePrice,
    #[msg("Intervalo de confiança do oráculo acima do tolerado")]
    OracleConfidenceTooWide,
    #[msg("Atualização de preço sem verificação completa")]
    OracleNotFullyVerified,
    #[msg("Configuração de oráculo inválida")]
    InvalidOracleConfig,
    #[msg("Período de carência do vesting ainda não encerrado")]
    VestingCliffNotReached,
    #[msg("Nenhum token liberado para saque")]
    NothingToClaim,
    #[msg("Confirmação explícita obrigatória para operação irreversível")]
    ConfirmationRequired,
    #[msg("Não há administrador pendente")]
    NoPendingAdmin,
    #[msg("Hash SHA-256 da imagem do token ausente")]
    InvalidImageHash,
    #[msg("Supply de referência zerado")]
    ZeroReferenceSupply,
}
