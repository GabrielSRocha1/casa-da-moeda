//! Constantes globais do protocolo Mastter.Digital Factory.

/// Seeds determinísticas das PDAs.
pub const SEED_CONFIG: &[u8] = b"config";
pub const SEED_VAULT: &[u8] = b"entity_vault";
pub const SEED_REGISTRY: &[u8] = b"registry";
pub const SEED_LEDGER: &[u8] = b"ledger";
pub const SEED_MINT: &[u8] = b"mint";
pub const SEED_VESTING: &[u8] = b"vesting";
pub const SEED_VESTING_ESCROW: &[u8] = b"vesting_escrow";
pub const SEED_SOL_TREASURY: &[u8] = b"sol_treasury";
pub const SEED_USDC_TREASURY: &[u8] = b"usdc_treasury";
pub const SEED_BUYER: &[u8] = b"buyer";
pub const SEED_PROFIT: &[u8] = b"profit";

/// Taxa padrão de serviço da Mastter.Digital: 1,19% = 119 basis points.
pub const DEFAULT_PLATFORM_FEE_BPS: u16 = 119;
/// Teto absoluto de taxa que o administrador pode configurar (5%).
pub const MAX_PLATFORM_FEE_BPS: u16 = 500;
pub const BPS_DENOMINATOR: u64 = 10_000;

/// Únicas opções de Hard Cap aceitas (em tokens inteiros).
pub const HARD_CAP_OPTIONS: [u64; 3] = [25_000_000, 50_000_000, 100_000_000];

/// Vesting da entidade: 30% do Hard Cap, carência de 180 dias,
/// cronograma total de 24 meses (730 dias) contados da ativação do cofre.
pub const VESTING_ALLOCATION_PCT: u64 = 30;
pub const SECONDS_PER_DAY: i64 = 86_400;
pub const VESTING_CLIFF_SECS: i64 = 180 * SECONDS_PER_DAY;
pub const VESTING_TOTAL_SECS: i64 = 730 * SECONDS_PER_DAY;

pub const MAX_DECIMALS: u8 = 9;
pub const SOL_DECIMALS: u8 = 9;

/// Unidade de referência comum: nano-USD (1e-9 USD).
pub const VALUE_SCALE_EXP: i32 = 9;

/// Limites de segurança dos parâmetros do oráculo.
pub const MAX_PRICE_AGE_LIMIT_SECS: u64 = 600;
pub const MAX_CONF_BPS_LIMIT: u16 = 500;

/// Janela operacional recomendada (não restritiva) para inject_daily_profit.
pub const RECOMMENDED_INJECTION_HOUR: u8 = 19;

/// Tamanhos máximos das Strings (bytes UTF-8).
pub const MAX_TOKEN_NAME_LEN: usize = 32;
pub const MAX_TOKEN_SYMBOL_LEN: usize = 10;
pub const MAX_TOKEN_URI_LEN: usize = 200;
pub const MAX_COMPANY_NAME_LEN: usize = 64;
pub const MAX_ADDRESS_LEN: usize = 128;
pub const MAX_PHONE_LEN: usize = 24;
pub const MAX_COUNTRY_LEN: usize = 32;
pub const MAX_DIRECTORS_LEN: usize = 160;
pub const MAX_PAYER_NAME_LEN: usize = 64;
pub const MAX_ORIGIN_LEN: usize = 48;
