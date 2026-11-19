/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/mastter_factory.json`.
 */
export type MastterFactory = {
  "address": "FZ4dYHSvFs9eF1TnN9QLj5XUuhD3yWqM1us9itqjhrE9",
  "metadata": {
    "name": "mastterFactory",
    "version": "1.0.0",
    "spec": "0.1.0",
    "description": "Mastter.Digital — Smart Contract Factory multissetorial (cofres tokenizados com lastro, vesting e anti-whale)"
  },
  "instructions": [
    {
      "name": "acceptAdmin",
      "docs": [
        "Transferência de administração em dois passos (2/2)."
      ],
      "discriminator": [
        112,
        42,
        45,
        90,
        116,
        181,
        13,
        170
      ],
      "accounts": [
        {
          "name": "newAdmin",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "activateEntityVault",
      "docs": [
        "Ativa o cofre: Mint Token-2022, cofres SOL/USDC, vesting de 30% e lastro inicial.",
        "Nome, símbolo, URI e hash da imagem ficam imutáveis a partir daqui."
      ],
      "discriminator": [
        99,
        96,
        15,
        204,
        220,
        149,
        140,
        163
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "funder",
          "docs": [
            "Quem aporta o lastro inicial em USDC (pode ser o próprio admin ou o pagador da entidade)."
          ],
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  116,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.entity_id",
                "account": "entityVault"
              }
            ]
          },
          "relations": [
            "ledger"
          ]
        },
        {
          "name": "ledger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "mint",
          "docs": [
            "Mint Token-2022 da entidade: mint authority = PDA do cofre, freeze authority nula,",
            "extensões: MetadataPointer + TokenMetadata (somente)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vesting",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vestingEscrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  115,
                  116,
                  105,
                  110,
                  103,
                  95,
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "solTreasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  111,
                  108,
                  95,
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "usdcTreasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  100,
                  99,
                  95,
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "funderUsdcAccount",
          "writable": true
        },
        {
          "name": "token2022Program",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "tokenUri",
          "type": "string"
        },
        {
          "name": "imageSha256",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "buyTokens",
      "docs": [
        "Compra de tokens com SOL ou USDC."
      ],
      "discriminator": [
        189,
        21,
        230,
        133,
        247,
        2,
        110,
        42
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  116,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.entity_id",
                "account": "entityVault"
              }
            ]
          },
          "relations": [
            "ledger"
          ]
        },
        {
          "name": "ledger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          },
          "relations": [
            "vault"
          ]
        },
        {
          "name": "mint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          },
          "relations": [
            "vault"
          ]
        },
        {
          "name": "userTokenAccount",
          "docs": [
            "Conta Token-2022 do comprador para o token da entidade."
          ],
          "writable": true
        },
        {
          "name": "buyerRecord",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "solTreasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  111,
                  108,
                  95,
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          },
          "relations": [
            "vault"
          ]
        },
        {
          "name": "usdcTreasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  100,
                  99,
                  95,
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          },
          "relations": [
            "vault"
          ]
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "userUsdcAccount",
          "docs": [
            "Conta USDC do comprador (obrigatória quando asset = Usdc)."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "revenueWallet",
          "writable": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "revenueUsdcAccount",
          "docs": [
            "Conta USDC da carteira de receita (obrigatória quando asset = Usdc)."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "solPriceFeed"
        },
        {
          "name": "usdcPriceFeed"
        },
        {
          "name": "token2022Program",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "asset",
          "type": {
            "defined": {
              "name": "paymentAsset"
            }
          }
        },
        {
          "name": "amountIn",
          "type": "u64"
        },
        {
          "name": "minTokensOut",
          "type": "u64"
        },
        {
          "name": "deadlineTs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "claimVestedTokens",
      "docs": [
        "Saque dos tokens liberados pelo vesting para a Verum Wallet."
      ],
      "discriminator": [
        165,
        219,
        11,
        0,
        187,
        52,
        142,
        199
      ],
      "accounts": [
        {
          "name": "beneficiary",
          "docs": [
            "A própria Verum Wallet cadastrada deve assinar."
          ],
          "signer": true,
          "relations": [
            "vesting"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  116,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.entity_id",
                "account": "entityVault"
              }
            ]
          },
          "relations": [
            "ledger",
            "vesting"
          ]
        },
        {
          "name": "ledger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          },
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vesting",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          },
          "relations": [
            "vault"
          ]
        },
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  115,
                  116,
                  105,
                  110,
                  103,
                  95,
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          },
          "relations": [
            "vesting"
          ]
        },
        {
          "name": "mint",
          "relations": [
            "vault",
            "vesting"
          ]
        },
        {
          "name": "destination",
          "docs": [
            "Conta Token-2022 de destino: obrigatoriamente de propriedade da Verum Wallet."
          ],
          "writable": true
        },
        {
          "name": "token2022Program",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        }
      ],
      "args": []
    },
    {
      "name": "closeMinting",
      "docs": [
        "IRREVERSÍVEL: revoga a Mint Authority do token da entidade."
      ],
      "discriminator": [
        206,
        132,
        179,
        8,
        201,
        208,
        243,
        6
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  116,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.entity_id",
                "account": "entityVault"
              }
            ]
          }
        },
        {
          "name": "mint",
          "writable": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "token2022Program",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        }
      ],
      "args": [
        {
          "name": "confirm",
          "type": "bool"
        }
      ]
    },
    {
      "name": "emitVaultSnapshot",
      "docs": [
        "Emite um retrato contábil do cofre (NAV, preço, segregações)."
      ],
      "discriminator": [
        175,
        121,
        179,
        24,
        125,
        125,
        252,
        48
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  116,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.entity_id",
                "account": "entityVault"
              }
            ]
          },
          "relations": [
            "ledger"
          ]
        },
        {
          "name": "ledger",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          },
          "relations": [
            "vault"
          ]
        },
        {
          "name": "solPriceFeed"
        },
        {
          "name": "usdcPriceFeed"
        }
      ],
      "args": []
    },
    {
      "name": "initializeEntityVault",
      "docs": [
        "Cadastra a entidade: EntityVault + RegistryData + BackingLedger."
      ],
      "discriminator": [
        99,
        158,
        34,
        251,
        190,
        114,
        25,
        17
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  116,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "args.entity_id"
              }
            ]
          }
        },
        {
          "name": "registry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "ledger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "verumWallet",
          "docs": [
            "igual ao parâmetro `verum_wallet_address`, distinta de admin/receita/PDAs do cofre."
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "initializeEntityVaultArgs"
            }
          }
        }
      ]
    },
    {
      "name": "initializeFactory",
      "docs": [
        "Cria a configuração global. Somente a upgrade authority do programa."
      ],
      "discriminator": [
        179,
        64,
        75,
        250,
        39,
        254,
        240,
        178
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "program",
          "docs": [
            "O próprio programa: usado para localizar a conta ProgramData."
          ],
          "address": "FZ4dYHSvFs9eF1TnN9QLj5XUuhD3yWqM1us9itqjhrE9"
        },
        {
          "name": "programData",
          "docs": [
            "Somente a upgrade authority atual pode inicializar (anti front-running)."
          ]
        },
        {
          "name": "usdcMint",
          "docs": [
            "Mint do USDC: obrigatoriamente SPL Token clássico (sem extensões)."
          ]
        },
        {
          "name": "revenueWallet"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "initializeFactoryArgs"
            }
          }
        }
      ]
    },
    {
      "name": "injectDailyProfit",
      "docs": [
        "Injeção de lucro/faturamento no lastro (sem cunhagem)."
      ],
      "discriminator": [
        146,
        14,
        153,
        127,
        165,
        208,
        6,
        44
      ],
      "accounts": [
        {
          "name": "injector",
          "docs": [
            "Remetente autorizado (profit_injector do cofre)."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  116,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.entity_id",
                "account": "entityVault"
              }
            ]
          },
          "relations": [
            "ledger"
          ]
        },
        {
          "name": "ledger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          },
          "relations": [
            "vault"
          ]
        },
        {
          "name": "receipt",
          "docs": [
            "Recibo único por `reference_id`: impede a duplicação do mesmo repasse."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "arg",
                "path": "referenceId"
              }
            ]
          }
        },
        {
          "name": "solTreasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  111,
                  108,
                  95,
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          },
          "relations": [
            "vault"
          ]
        },
        {
          "name": "usdcTreasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  100,
                  99,
                  95,
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          },
          "relations": [
            "vault"
          ]
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "injectorUsdcAccount",
          "docs": [
            "Conta USDC do remetente (obrigatória quando asset = Usdc)."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "revenueWallet",
          "writable": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "revenueUsdcAccount",
          "docs": [
            "Conta USDC da carteira de receita (obrigatória quando asset = Usdc e houver taxa)."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "asset",
          "type": {
            "defined": {
              "name": "paymentAsset"
            }
          }
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "referenceId",
          "type": "u64"
        },
        {
          "name": "origin",
          "type": "string"
        }
      ]
    },
    {
      "name": "proposeAdmin",
      "docs": [
        "Transferência de administração em dois passos (1/2)."
      ],
      "discriminator": [
        121,
        214,
        199,
        212,
        87,
        39,
        117,
        234
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newAdmin",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "sellTokens",
      "docs": [
        "Resgate: queima tokens e paga o valor proporcional em SOL ou USDC."
      ],
      "discriminator": [
        114,
        242,
        25,
        12,
        62,
        126,
        92,
        2
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  116,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.entity_id",
                "account": "entityVault"
              }
            ]
          },
          "relations": [
            "ledger"
          ]
        },
        {
          "name": "ledger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          },
          "relations": [
            "vault"
          ]
        },
        {
          "name": "mint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          },
          "relations": [
            "vault"
          ]
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "buyerRecord",
          "docs": [
            "Registro de compras do usuário (opcional; reduz `net_acquired` no resgate)."
          ],
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "solTreasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  111,
                  108,
                  95,
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          },
          "relations": [
            "vault"
          ]
        },
        {
          "name": "usdcTreasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  100,
                  99,
                  95,
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          },
          "relations": [
            "vault"
          ]
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "userUsdcAccount",
          "docs": [
            "Conta USDC do usuário (obrigatória quando asset = Usdc)."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "revenueWallet",
          "writable": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "revenueUsdcAccount",
          "docs": [
            "Conta USDC da carteira de receita (obrigatória quando asset = Usdc)."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "solPriceFeed"
        },
        {
          "name": "usdcPriceFeed"
        },
        {
          "name": "token2022Program",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "asset",
          "type": {
            "defined": {
              "name": "paymentAsset"
            }
          }
        },
        {
          "name": "tokenAmount",
          "type": "u64"
        },
        {
          "name": "minAmountOut",
          "type": "u64"
        },
        {
          "name": "deadlineTs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "setFactoryPaused",
      "docs": [
        "Pausa/retoma todos os cofres."
      ],
      "discriminator": [
        31,
        192,
        53,
        146,
        185,
        159,
        2,
        2
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setVaultPaused",
      "docs": [
        "Pausa/retoma um cofre específico."
      ],
      "discriminator": [
        239,
        131,
        203,
        69,
        243,
        11,
        234,
        153
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  116,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.entity_id",
                "account": "entityVault"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "updateEntityConfig",
      "docs": [
        "Ajusta anti-whale, taxa, remetente de lucro e carteira de receita do cofre."
      ],
      "discriminator": [
        255,
        55,
        35,
        185,
        0,
        127,
        243,
        155
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  116,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.entity_id",
                "account": "entityVault"
              }
            ]
          }
        },
        {
          "name": "newRevenueWallet",
          "optional": true
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "updateEntityConfigArgs"
            }
          }
        }
      ]
    },
    {
      "name": "updateFactoryConfig",
      "docs": [
        "Atualiza oráculo, limites e carteira de receita padrão."
      ],
      "discriminator": [
        219,
        46,
        19,
        240,
        1,
        37,
        160,
        26
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "newRevenueWallet",
          "optional": true
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "updateFactoryConfigArgs"
            }
          }
        }
      ]
    },
    {
      "name": "updateRegistryData",
      "docs": [
        "Atualiza os dados cadastrais (RegistryData)."
      ],
      "discriminator": [
        229,
        2,
        140,
        107,
        68,
        77,
        169,
        238
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  116,
                  105,
                  116,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.entity_id",
                "account": "entityVault"
              }
            ]
          },
          "relations": [
            "registry"
          ]
        },
        {
          "name": "registry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "updateRegistryArgs"
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "backingLedger",
      "discriminator": [
        125,
        37,
        162,
        46,
        228,
        7,
        57,
        128
      ]
    },
    {
      "name": "buyerRecord",
      "discriminator": [
        107,
        122,
        54,
        31,
        4,
        54,
        209,
        38
      ]
    },
    {
      "name": "entityVault",
      "discriminator": [
        79,
        128,
        25,
        157,
        42,
        103,
        87,
        3
      ]
    },
    {
      "name": "factoryConfig",
      "discriminator": [
        29,
        197,
        255,
        232,
        22,
        128,
        67,
        26
      ]
    },
    {
      "name": "profitReceipt",
      "discriminator": [
        213,
        202,
        107,
        202,
        68,
        206,
        130,
        222
      ]
    },
    {
      "name": "registryData",
      "discriminator": [
        43,
        38,
        167,
        114,
        213,
        31,
        56,
        240
      ]
    },
    {
      "name": "vestingAccount",
      "discriminator": [
        102,
        73,
        10,
        233,
        200,
        188,
        228,
        216
      ]
    }
  ],
  "events": [
    {
      "name": "administrativeConfigurationUpdated",
      "discriminator": [
        247,
        62,
        128,
        57,
        184,
        255,
        213,
        63
      ]
    },
    {
      "name": "entityVaultActivated",
      "discriminator": [
        87,
        79,
        104,
        79,
        231,
        128,
        206,
        181
      ]
    },
    {
      "name": "entityVaultInitialized",
      "discriminator": [
        231,
        161,
        250,
        30,
        98,
        77,
        46,
        131
      ]
    },
    {
      "name": "factoryInitialized",
      "discriminator": [
        20,
        86,
        103,
        75,
        20,
        220,
        162,
        63
      ]
    },
    {
      "name": "hardCapReached",
      "discriminator": [
        130,
        230,
        83,
        152,
        186,
        0,
        27,
        229
      ]
    },
    {
      "name": "platformFeeCollected",
      "discriminator": [
        44,
        79,
        0,
        185,
        164,
        86,
        134,
        83
      ]
    },
    {
      "name": "profitInjected",
      "discriminator": [
        189,
        100,
        234,
        185,
        112,
        120,
        192,
        254
      ]
    },
    {
      "name": "tokenPurchased",
      "discriminator": [
        3,
        73,
        186,
        50,
        15,
        181,
        213,
        37
      ]
    },
    {
      "name": "tokenRedeemed",
      "discriminator": [
        75,
        7,
        43,
        228,
        204,
        167,
        97,
        76
      ]
    },
    {
      "name": "vaultPaused",
      "discriminator": [
        198,
        157,
        22,
        151,
        68,
        100,
        162,
        35
      ]
    },
    {
      "name": "vaultResumed",
      "discriminator": [
        208,
        173,
        238,
        64,
        33,
        63,
        226,
        151
      ]
    },
    {
      "name": "vaultSnapshot",
      "discriminator": [
        130,
        0,
        159,
        145,
        196,
        29,
        89,
        124
      ]
    },
    {
      "name": "vestedTokensClaimed",
      "discriminator": [
        15,
        7,
        248,
        165,
        41,
        118,
        87,
        175
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Assinante não autorizado para esta operação"
    },
    {
      "code": 6001,
      "name": "notUpgradeAuthority",
      "msg": "Somente a upgrade authority do programa pode inicializar a Factory"
    },
    {
      "code": 6002,
      "name": "invalidProgramData",
      "msg": "Conta ProgramData inválida"
    },
    {
      "code": 6003,
      "name": "factoryPaused",
      "msg": "Factory pausada"
    },
    {
      "code": 6004,
      "name": "vaultNotActive",
      "msg": "Cofre não está ativo"
    },
    {
      "code": 6005,
      "name": "invalidVaultStatus",
      "msg": "Cofre já foi ativado ou está em estado inválido para esta operação"
    },
    {
      "code": 6006,
      "name": "invalidHardCap",
      "msg": "Hard Cap inválido: use 25.000.000, 50.000.000 ou 100.000.000"
    },
    {
      "code": 6007,
      "name": "invalidDecimals",
      "msg": "Decimais inválidos (máximo 9)"
    },
    {
      "code": 6008,
      "name": "invalidStringLength",
      "msg": "String vazia ou acima do tamanho máximo permitido"
    },
    {
      "code": 6009,
      "name": "invalidAntiWhaleParams",
      "msg": "Parâmetros anti-whale inconsistentes"
    },
    {
      "code": 6010,
      "name": "invalidFee",
      "msg": "Taxa de plataforma acima do teto permitido"
    },
    {
      "code": 6011,
      "name": "invalidAmount",
      "msg": "Valor inválido (zero ou fora dos limites)"
    },
    {
      "code": 6012,
      "name": "invalidVerumWallet",
      "msg": "Verum Wallet inválida"
    },
    {
      "code": 6013,
      "name": "invalidRevenueWallet",
      "msg": "Carteira de receita inválida"
    },
    {
      "code": 6014,
      "name": "belowMinBuy",
      "msg": "Compra abaixo do mínimo por transação"
    },
    {
      "code": 6015,
      "name": "aboveMaxBuy",
      "msg": "Compra acima do máximo por transação"
    },
    {
      "code": 6016,
      "name": "maxWalletExceeded",
      "msg": "Limite máximo de tokens por carteira excedido"
    },
    {
      "code": 6017,
      "name": "hardCapExceeded",
      "msg": "Hard Cap excedido"
    },
    {
      "code": 6018,
      "name": "mintingClosed",
      "msg": "Cunhagem encerrada: Mint Authority revogada"
    },
    {
      "code": 6019,
      "name": "slippageExceeded",
      "msg": "Slippage excedido"
    },
    {
      "code": 6020,
      "name": "deadlineExceeded",
      "msg": "Prazo da transação expirado"
    },
    {
      "code": 6021,
      "name": "insufficientUserBalance",
      "msg": "Saldo insuficiente do usuário"
    },
    {
      "code": 6022,
      "name": "insufficientLiquidity",
      "msg": "Lastro contabilizado insuficiente neste ativo para o resgate"
    },
    {
      "code": 6023,
      "name": "insufficientTreasuryBalance",
      "msg": "Saldo real do cofre insuficiente"
    },
    {
      "code": 6024,
      "name": "missingPaymentAccount",
      "msg": "Conta do ativo de pagamento ausente"
    },
    {
      "code": 6025,
      "name": "mathOverflow",
      "msg": "Overflow/underflow aritmético"
    },
    {
      "code": 6026,
      "name": "invalidOracleAccount",
      "msg": "Conta de oráculo inválida"
    },
    {
      "code": 6027,
      "name": "oracleFeedMismatch",
      "msg": "Feed de preço não corresponde ao configurado"
    },
    {
      "code": 6028,
      "name": "staleOraclePrice",
      "msg": "Preço do oráculo desatualizado"
    },
    {
      "code": 6029,
      "name": "invalidOraclePrice",
      "msg": "Preço do oráculo inválido (não positivo)"
    },
    {
      "code": 6030,
      "name": "oracleConfidenceTooWide",
      "msg": "Intervalo de confiança do oráculo acima do tolerado"
    },
    {
      "code": 6031,
      "name": "oracleNotFullyVerified",
      "msg": "Atualização de preço sem verificação completa"
    },
    {
      "code": 6032,
      "name": "invalidOracleConfig",
      "msg": "Configuração de oráculo inválida"
    },
    {
      "code": 6033,
      "name": "vestingCliffNotReached",
      "msg": "Período de carência do vesting ainda não encerrado"
    },
    {
      "code": 6034,
      "name": "nothingToClaim",
      "msg": "Nenhum token liberado para saque"
    },
    {
      "code": 6035,
      "name": "confirmationRequired",
      "msg": "Confirmação explícita obrigatória para operação irreversível"
    },
    {
      "code": 6036,
      "name": "noPendingAdmin",
      "msg": "Não há administrador pendente"
    },
    {
      "code": 6037,
      "name": "invalidImageHash",
      "msg": "Hash SHA-256 da imagem do token ausente"
    },
    {
      "code": 6038,
      "name": "zeroReferenceSupply",
      "msg": "Supply de referência zerado"
    }
  ],
  "types": [
    {
      "name": "administrativeConfigurationUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "scope",
            "type": {
              "defined": {
                "name": "configScope"
              }
            }
          },
          {
            "name": "entityId",
            "type": "u64"
          },
          {
            "name": "target",
            "type": "pubkey"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "backingLedger",
      "docs": [
        "Controle de lastro, taxas e histórico agregado (PDA [\"ledger\", vault])."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "solBacking",
            "docs": [
              "Lastro contabilizado (somente entradas via programa; doações diretas não contam)."
            ],
            "type": "u64"
          },
          {
            "name": "usdcBacking",
            "type": "u64"
          },
          {
            "name": "solFeesCollected",
            "docs": [
              "Receita da plataforma (já repassada à carteira de receita; nunca compõe o lastro)."
            ],
            "type": "u64"
          },
          {
            "name": "usdcFeesCollected",
            "type": "u64"
          },
          {
            "name": "solProfitInjected",
            "docs": [
              "Depósitos de lucro (líquidos) acumulados."
            ],
            "type": "u64"
          },
          {
            "name": "usdcProfitInjected",
            "type": "u64"
          },
          {
            "name": "solBuyInflow",
            "docs": [
              "Entradas líquidas por compras."
            ],
            "type": "u64"
          },
          {
            "name": "usdcBuyInflow",
            "type": "u64"
          },
          {
            "name": "solRedeemed",
            "docs": [
              "Saídas brutas por resgates."
            ],
            "type": "u64"
          },
          {
            "name": "usdcRedeemed",
            "type": "u64"
          },
          {
            "name": "buyCount",
            "type": "u64"
          },
          {
            "name": "sellCount",
            "type": "u64"
          },
          {
            "name": "profitCount",
            "type": "u64"
          },
          {
            "name": "claimCount",
            "type": "u64"
          },
          {
            "name": "lastOperationTs",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "buyerRecord",
      "docs": [
        "Controle de compras por carteira (PDA [\"buyer\", vault, buyer])."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "totalPurchased",
            "type": "u64"
          },
          {
            "name": "totalSold",
            "type": "u64"
          },
          {
            "name": "netAcquired",
            "docs": [
              "Compras líquidas (compradas - resgatadas) via programa; limitado a max_wallet."
            ],
            "type": "u64"
          },
          {
            "name": "purchaseCount",
            "type": "u32"
          },
          {
            "name": "lastPurchaseTs",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "configScope",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "factory"
          },
          {
            "name": "adminTransfer"
          },
          {
            "name": "entityVault"
          },
          {
            "name": "registry"
          },
          {
            "name": "mintAuthorityRevoked"
          }
        ]
      }
    },
    {
      "name": "entityVault",
      "docs": [
        "Cofre de uma entidade (PDA [\"entity_vault\", entity_id LE])."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "entityId",
            "type": "u64"
          },
          {
            "name": "contractNumber",
            "type": "u64"
          },
          {
            "name": "authority",
            "docs": [
              "Autoridade administrativa (espelho do admin da Factory no último ato administrativo)."
            ],
            "type": "pubkey"
          },
          {
            "name": "profitInjector",
            "docs": [
              "Remetente autorizado de `inject_daily_profit`."
            ],
            "type": "pubkey"
          },
          {
            "name": "verumWallet",
            "docs": [
              "Destino exclusivo e imutável do vesting."
            ],
            "type": "pubkey"
          },
          {
            "name": "revenueWallet",
            "docs": [
              "Carteira de receita autorizada (taxas)."
            ],
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "solTreasury",
            "type": "pubkey"
          },
          {
            "name": "usdcTreasury",
            "type": "pubkey"
          },
          {
            "name": "ledger",
            "type": "pubkey"
          },
          {
            "name": "vesting",
            "type": "pubkey"
          },
          {
            "name": "registry",
            "type": "pubkey"
          },
          {
            "name": "tokenName",
            "type": "string"
          },
          {
            "name": "tokenSymbol",
            "type": "string"
          },
          {
            "name": "decimals",
            "type": "u8"
          },
          {
            "name": "hardCapTokens",
            "docs": [
              "Hard Cap em tokens inteiros (25M / 50M / 100M)."
            ],
            "type": "u64"
          },
          {
            "name": "hardCap",
            "docs": [
              "Hard Cap em unidades-base (hard_cap_tokens * 10^decimals)."
            ],
            "type": "u64"
          },
          {
            "name": "initialPoolAmount",
            "docs": [
              "Lastro inicial em USDC (unidades-base) aportado na ativação."
            ],
            "type": "u64"
          },
          {
            "name": "minBuy",
            "type": "u64"
          },
          {
            "name": "maxBuy",
            "type": "u64"
          },
          {
            "name": "maxWallet",
            "type": "u64"
          },
          {
            "name": "platformFeeBps",
            "type": "u16"
          },
          {
            "name": "chargeFeeOnProfit",
            "type": "bool"
          },
          {
            "name": "circulatingSupply",
            "docs": [
              "Supply em circulação (fora do vesting)."
            ],
            "type": "u64"
          },
          {
            "name": "vestingLockedSupply",
            "docs": [
              "Supply bloqueado no escrow de vesting."
            ],
            "type": "u64"
          },
          {
            "name": "totalMinted",
            "type": "u64"
          },
          {
            "name": "totalBurned",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "vaultStatus"
              }
            }
          },
          {
            "name": "mintingClosed",
            "type": "bool"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "activatedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "mintBump",
            "type": "u8"
          },
          {
            "name": "solTreasuryBump",
            "type": "u8"
          },
          {
            "name": "usdcTreasuryBump",
            "type": "u8"
          },
          {
            "name": "ledgerBump",
            "type": "u8"
          },
          {
            "name": "vestingBump",
            "type": "u8"
          },
          {
            "name": "vestingEscrowBump",
            "type": "u8"
          },
          {
            "name": "registryBump",
            "type": "u8"
          },
          {
            "name": "imageSha256",
            "docs": [
              "SHA-256 do arquivo de imagem do token. Gravado uma única vez na ativação;",
              "nenhuma instrução o altera. Permite provar que a imagem nunca mudou."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "entityVaultActivated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "entityId",
            "type": "u64"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "solTreasury",
            "type": "pubkey"
          },
          {
            "name": "usdcTreasury",
            "type": "pubkey"
          },
          {
            "name": "vesting",
            "type": "pubkey"
          },
          {
            "name": "vestingAllocation",
            "type": "u64"
          },
          {
            "name": "vestingCliffTs",
            "type": "i64"
          },
          {
            "name": "vestingEndTs",
            "type": "i64"
          },
          {
            "name": "initialPoolAmount",
            "type": "u64"
          },
          {
            "name": "tokenUri",
            "type": "string"
          },
          {
            "name": "imageSha256",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "funder",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "entityVaultInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "entityId",
            "type": "u64"
          },
          {
            "name": "contractNumber",
            "type": "u64"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "registry",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "verumWallet",
            "type": "pubkey"
          },
          {
            "name": "revenueWallet",
            "type": "pubkey"
          },
          {
            "name": "tokenName",
            "type": "string"
          },
          {
            "name": "tokenSymbol",
            "type": "string"
          },
          {
            "name": "decimals",
            "type": "u8"
          },
          {
            "name": "hardCap",
            "type": "u64"
          },
          {
            "name": "minBuy",
            "type": "u64"
          },
          {
            "name": "maxBuy",
            "type": "u64"
          },
          {
            "name": "maxWallet",
            "type": "u64"
          },
          {
            "name": "platformFeeBps",
            "type": "u16"
          },
          {
            "name": "initialPoolAmount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "factoryConfig",
      "docs": [
        "Configuração global da Factory (PDA [\"config\"])."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "pendingAdmin",
            "type": "pubkey"
          },
          {
            "name": "revenueWallet",
            "docs": [
              "Carteira de receita padrão da Mastter.Digital (copiada para novos cofres)."
            ],
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "docs": [
              "Mint do USDC (SPL Token clássico) aceito pelo protocolo."
            ],
            "type": "pubkey"
          },
          {
            "name": "usdcDecimals",
            "type": "u8"
          },
          {
            "name": "oracleProgram",
            "docs": [
              "Programa dono das contas de preço (Pyth Solana Receiver)."
            ],
            "type": "pubkey"
          },
          {
            "name": "solPriceAccount",
            "type": "pubkey"
          },
          {
            "name": "usdcPriceAccount",
            "type": "pubkey"
          },
          {
            "name": "solFeedId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "usdcFeedId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "maxPriceAgeSecs",
            "type": "u64"
          },
          {
            "name": "maxConfBps",
            "type": "u16"
          },
          {
            "name": "defaultFeeBps",
            "type": "u16"
          },
          {
            "name": "opsUtcOffsetSecs",
            "docs": [
              "Offset UTC (segundos) usado apenas para sinalizar a janela recomendada das injeções."
            ],
            "type": "i32"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "entityCount",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "factoryInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "revenueWallet",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "oracleProgram",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "hardCapReached",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "entityId",
            "type": "u64"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "hardCap",
            "type": "u64"
          },
          {
            "name": "circulatingSupply",
            "type": "u64"
          },
          {
            "name": "vestingLockedSupply",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "initializeEntityVaultArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tokenName",
            "type": "string"
          },
          {
            "name": "tokenSymbol",
            "type": "string"
          },
          {
            "name": "decimals",
            "type": "u8"
          },
          {
            "name": "entityId",
            "type": "u64"
          },
          {
            "name": "contractNumber",
            "type": "u64"
          },
          {
            "name": "companyName",
            "type": "string"
          },
          {
            "name": "address",
            "type": "string"
          },
          {
            "name": "phone",
            "type": "string"
          },
          {
            "name": "country",
            "type": "string"
          },
          {
            "name": "directorsNames",
            "type": "string"
          },
          {
            "name": "payerName",
            "type": "string"
          },
          {
            "name": "verumWalletAddress",
            "type": "pubkey"
          },
          {
            "name": "initialPoolAmount",
            "docs": [
              "Lastro inicial em USDC (unidades-base), aportado em `activate_entity_vault`."
            ],
            "type": "u64"
          },
          {
            "name": "hardCap",
            "docs": [
              "Hard Cap em tokens inteiros: 25_000_000, 50_000_000 ou 100_000_000."
            ],
            "type": "u64"
          },
          {
            "name": "minBuy",
            "docs": [
              "Limites anti-whale em unidades-base do token."
            ],
            "type": "u64"
          },
          {
            "name": "maxBuy",
            "type": "u64"
          },
          {
            "name": "maxWallet",
            "type": "u64"
          },
          {
            "name": "platformFee",
            "docs": [
              "Taxa de plataforma em basis points (padrão 119 = 1,19%)."
            ],
            "type": "u16"
          },
          {
            "name": "profitInjector",
            "type": "pubkey"
          },
          {
            "name": "chargeFeeOnProfit",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "initializeFactoryArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oracleProgram",
            "type": "pubkey"
          },
          {
            "name": "solPriceAccount",
            "type": "pubkey"
          },
          {
            "name": "usdcPriceAccount",
            "type": "pubkey"
          },
          {
            "name": "solFeedId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "usdcFeedId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "maxPriceAgeSecs",
            "type": "u64"
          },
          {
            "name": "maxConfBps",
            "type": "u16"
          },
          {
            "name": "opsUtcOffsetSecs",
            "type": "i32"
          }
        ]
      }
    },
    {
      "name": "paymentAsset",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "sol"
          },
          {
            "name": "usdc"
          }
        ]
      }
    },
    {
      "name": "platformFeeCollected",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "entityId",
            "type": "u64"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "revenueWallet",
            "type": "pubkey"
          },
          {
            "name": "asset",
            "type": {
              "defined": {
                "name": "paymentAsset"
              }
            }
          },
          {
            "name": "feeAmount",
            "type": "u64"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "operation",
            "docs": [
              "0 = compra, 1 = resgate, 2 = injeção de lucro"
            ],
            "type": "u8"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "profitInjected",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "entityId",
            "type": "u64"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "injector",
            "type": "pubkey"
          },
          {
            "name": "origin",
            "type": "string"
          },
          {
            "name": "referenceId",
            "type": "u64"
          },
          {
            "name": "asset",
            "type": {
              "defined": {
                "name": "paymentAsset"
              }
            }
          },
          {
            "name": "grossAmount",
            "type": "u64"
          },
          {
            "name": "feeAmount",
            "type": "u64"
          },
          {
            "name": "netAmount",
            "type": "u64"
          },
          {
            "name": "solBacking",
            "type": "u64"
          },
          {
            "name": "usdcBacking",
            "type": "u64"
          },
          {
            "name": "referenceSupply",
            "type": "u64"
          },
          {
            "name": "localHour",
            "type": "u8"
          },
          {
            "name": "localWeekday",
            "type": "u8"
          },
          {
            "name": "withinRecommendedWindow",
            "type": "bool"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "profitReceipt",
      "docs": [
        "Recibo de injeção de lucro (PDA [\"profit\", vault, reference_id LE]).",
        "A criação com `init` impede a duplicação do mesmo repasse."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "entityId",
            "type": "u64"
          },
          {
            "name": "referenceId",
            "type": "u64"
          },
          {
            "name": "injector",
            "type": "pubkey"
          },
          {
            "name": "origin",
            "type": "string"
          },
          {
            "name": "asset",
            "type": {
              "defined": {
                "name": "paymentAsset"
              }
            }
          },
          {
            "name": "grossAmount",
            "type": "u64"
          },
          {
            "name": "feeAmount",
            "type": "u64"
          },
          {
            "name": "netAmount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "localHour",
            "type": "u8"
          },
          {
            "name": "localWeekday",
            "type": "u8"
          },
          {
            "name": "withinRecommendedWindow",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "registryData",
      "docs": [
        "Dados cadastrais da entidade (PDA [\"registry\", vault])."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "entityId",
            "type": "u64"
          },
          {
            "name": "contractNumber",
            "type": "u64"
          },
          {
            "name": "companyName",
            "type": "string"
          },
          {
            "name": "address",
            "type": "string"
          },
          {
            "name": "phone",
            "type": "string"
          },
          {
            "name": "country",
            "type": "string"
          },
          {
            "name": "directorsNames",
            "type": "string"
          },
          {
            "name": "payerName",
            "type": "string"
          },
          {
            "name": "registeredBy",
            "docs": [
              "Histórico de registro."
            ],
            "type": "pubkey"
          },
          {
            "name": "registeredAt",
            "type": "i64"
          },
          {
            "name": "lastUpdatedBy",
            "type": "pubkey"
          },
          {
            "name": "lastUpdatedAt",
            "type": "i64"
          },
          {
            "name": "updateCount",
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "tokenPurchased",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "entityId",
            "type": "u64"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "asset",
            "type": {
              "defined": {
                "name": "paymentAsset"
              }
            }
          },
          {
            "name": "grossAmount",
            "type": "u64"
          },
          {
            "name": "feeAmount",
            "type": "u64"
          },
          {
            "name": "netAmount",
            "type": "u64"
          },
          {
            "name": "tokensMinted",
            "type": "u64"
          },
          {
            "name": "circulatingSupply",
            "type": "u64"
          },
          {
            "name": "referenceSupply",
            "type": "u64"
          },
          {
            "name": "solBacking",
            "type": "u64"
          },
          {
            "name": "usdcBacking",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "tokenRedeemed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "entityId",
            "type": "u64"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "asset",
            "type": {
              "defined": {
                "name": "paymentAsset"
              }
            }
          },
          {
            "name": "tokensBurned",
            "type": "u64"
          },
          {
            "name": "grossAmount",
            "type": "u64"
          },
          {
            "name": "feeAmount",
            "type": "u64"
          },
          {
            "name": "netAmount",
            "type": "u64"
          },
          {
            "name": "circulatingSupply",
            "type": "u64"
          },
          {
            "name": "referenceSupply",
            "type": "u64"
          },
          {
            "name": "solBacking",
            "type": "u64"
          },
          {
            "name": "usdcBacking",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "updateEntityConfigArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "minBuy",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "maxBuy",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "maxWallet",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "platformFeeBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "profitInjector",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "chargeFeeOnProfit",
            "type": {
              "option": "bool"
            }
          }
        ]
      }
    },
    {
      "name": "updateFactoryConfigArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oracleProgram",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "solPriceAccount",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "usdcPriceAccount",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "solFeedId",
            "type": {
              "option": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          },
          {
            "name": "usdcFeedId",
            "type": {
              "option": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          },
          {
            "name": "maxPriceAgeSecs",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "maxConfBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "opsUtcOffsetSecs",
            "type": {
              "option": "i32"
            }
          }
        ]
      }
    },
    {
      "name": "updateRegistryArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "companyName",
            "type": "string"
          },
          {
            "name": "address",
            "type": "string"
          },
          {
            "name": "phone",
            "type": "string"
          },
          {
            "name": "country",
            "type": "string"
          },
          {
            "name": "directorsNames",
            "type": "string"
          },
          {
            "name": "payerName",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "vaultPaused",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "entityId",
            "type": "u64"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "factoryWide",
            "type": "bool"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "vaultResumed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "entityId",
            "type": "u64"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "factoryWide",
            "type": "bool"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "vaultSnapshot",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "entityId",
            "type": "u64"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "solBacking",
            "type": "u64"
          },
          {
            "name": "usdcBacking",
            "type": "u64"
          },
          {
            "name": "circulatingSupply",
            "type": "u64"
          },
          {
            "name": "vestingLockedSupply",
            "type": "u64"
          },
          {
            "name": "navNanoUsd",
            "docs": [
              "NAV total em nano-USD (preço médio do oráculo)."
            ],
            "type": "u128"
          },
          {
            "name": "pricePerTokenNanoUsd",
            "docs": [
              "Preço por token inteiro em nano-USD."
            ],
            "type": "u128"
          },
          {
            "name": "reservedForRedemptionsNanoUsd",
            "docs": [
              "Parcela do lastro reservada para resgates do supply circulante (nano-USD)."
            ],
            "type": "u128"
          },
          {
            "name": "vestingBackingNanoUsd",
            "docs": [
              "Parcela do lastro vinculada aos tokens bloqueados em vesting (nano-USD)."
            ],
            "type": "u128"
          },
          {
            "name": "solFeesCollected",
            "type": "u64"
          },
          {
            "name": "usdcFeesCollected",
            "type": "u64"
          },
          {
            "name": "solProfitInjected",
            "type": "u64"
          },
          {
            "name": "usdcProfitInjected",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "vaultStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "pendingActivation"
          },
          {
            "name": "active"
          },
          {
            "name": "paused"
          }
        ]
      }
    },
    {
      "name": "vestedTokensClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "entityId",
            "type": "u64"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "beneficiary",
            "type": "pubkey"
          },
          {
            "name": "destination",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "totalReleased",
            "type": "u64"
          },
          {
            "name": "remaining",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "vestingAccount",
      "docs": [
        "Vesting de 30% do Hard Cap (PDA [\"vesting\", vault])."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "escrow",
            "type": "pubkey"
          },
          {
            "name": "beneficiary",
            "docs": [
              "Destinatário autorizado (Verum Wallet)."
            ],
            "type": "pubkey"
          },
          {
            "name": "totalAllocated",
            "type": "u64"
          },
          {
            "name": "released",
            "type": "u64"
          },
          {
            "name": "remaining",
            "type": "u64"
          },
          {
            "name": "startTs",
            "type": "i64"
          },
          {
            "name": "cliffTs",
            "type": "i64"
          },
          {
            "name": "endTs",
            "type": "i64"
          },
          {
            "name": "lastClaimTs",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
