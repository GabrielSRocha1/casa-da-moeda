#!/usr/bin/env bash
# Sobe um solana-test-validator limpo, implanta o programa e roda scripts/localnet-e2e.ts.
# Requer: solana CLI no PATH, `anchor build` já executado, npm install feito.
set -euo pipefail
cd "$(dirname "$0")/.."
WORK=$(mktemp -d); trap 'kill $VPID 2>/dev/null || true; rm -rf "$WORK"' EXIT
solana-keygen new --no-bip39-passphrase -s -o "$WORK/admin.json" >/dev/null
node - "$WORK" <<'JS'
// Contas de preço simuladas (layout PriceUpdateV2), publicadas "agora".
const fs=require("fs"),{Keypair}=require("@solana/web3.js");const dir=process.argv[2];
const disc=Buffer.from([34,241,35,99,157,126,244,205]);const now=BigInt(Math.floor(Date.now()/1000));
const oracle=Keypair.generate().publicKey;const out={oracleProgram:oracle.toBase58(),adminKeypair:dir+"/admin.json"};
for(const [name,feedByte,price] of [["sol",0xa1,15000000000n],["usdc",0xb2,100000000n]]){
  const feed=Buffer.alloc(32,feedByte);const msg=Buffer.alloc(84);feed.copy(msg,0);
  msg.writeBigInt64LE(price,32);msg.writeBigUInt64LE(0n,40);msg.writeInt32LE(-8,48);msg.writeBigInt64LE(now,52);msg.writeBigInt64LE(now-1n,60);msg.writeBigInt64LE(price,68);msg.writeBigUInt64LE(0n,76);
  const data=Buffer.concat([disc,Keypair.generate().publicKey.toBuffer(),Buffer.from([1]),msg,Buffer.alloc(8)]);
  const key=Keypair.generate().publicKey.toBase58();
  fs.writeFileSync(`${dir}/${name}.json`,JSON.stringify({pubkey:key,account:{lamports:10000000,data:[data.toString("base64"),"base64"],owner:oracle.toBase58(),executable:false,rentEpoch:0,space:data.length}}));
  out[name+"Price"]=key;out[name+"FeedId"]=feed.toString("hex");
}
fs.writeFileSync(dir+"/config.json",JSON.stringify(out));
JS
SOLP=$(node -e "console.log(require('$WORK/config.json').solPrice)"); USDP=$(node -e "console.log(require('$WORK/config.json').usdcPrice)")
solana-test-validator --reset --quiet --ledger "$WORK/ledger" --mint "$(solana-keygen pubkey "$WORK/admin.json")" \
  --account "$SOLP" "$WORK/sol.json" --account "$USDP" "$WORK/usdc.json" >"$WORK/validator.log" 2>&1 &
VPID=$!
for i in $(seq 1 60); do solana -u http://127.0.0.1:8899 cluster-version >/dev/null 2>&1 && break; sleep 1; done
solana -u http://127.0.0.1:8899 -k "$WORK/admin.json" program deploy target/deploy/mastter_factory.so \
  --program-id target/deploy/mastter_factory-keypair.json | tail -1
E2E_CONFIG="$WORK/config.json" npx ts-node -P tsconfig.json scripts/localnet-e2e.ts
