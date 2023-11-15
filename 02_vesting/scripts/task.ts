import {
  Lucid,
  SpendingValidator,
  UTxO,
} from "https://deno.land/x/lucid@0.10.7/mod.ts";
import {
  awaitTxConfirms,
  cardanoscanLink,
  filterUTXOsByTxHash,
  getCurrentTime,
  getWalletBalanceLovelace,
  hour,
} from "../../common/offchain/utils.ts";
import blueprint from "../plutus.json" assert { type: "json" };
import {
  failTest,
  failTests,
  passAllTests,
  passTest,
} from "../../common/offchain/test_utils.ts";
import { createVestingDatum } from "./types.ts";

type GameData = {
  vestingValidator: SpendingValidator;
  vestingAddress: string;
  vestingtUtxo: UTxO;
  lockUntil: number;
  originalBalance: bigint;
  txHash: string;
  startTime: number;
};

function readValidator(): SpendingValidator {
  const validator = blueprint.validators.find(
    (v) => v.title === "vesting.vesting",
  );

  if (validator?.compiledCode === undefined) {
    throw new Error("Compiled code for vesting validator was not found.");
  }

  return {
    type: "PlutusV2",
    script: validator?.compiledCode,
  };
}

export async function setup(lucid: Lucid) {
  console.log(`\n=== SETUP IN PROGRESS ===`);

  const validator = readValidator();

  console.log(`Creating a vesting UTxO that locks 5 ADA for 5 hours...\n`);

  const vestingAddress = lucid.utils.validatorToAddress(validator);
  const beneficiary = await lucid.wallet.address();
  const vestedValue = 5000000n;
  const startTime = getCurrentTime(lucid);
  const lockedUntil = getCurrentTime(lucid) + 5 * hour();
  const datum = createVestingDatum(lucid, BigInt(lockedUntil), beneficiary);

  const tx = await lucid
    .newTx()
    .payToContract(vestingAddress, { inline: datum }, { lovelace: vestedValue })
    .complete();

  const signedTx = await tx.sign().complete();

  const txHash = await signedTx.submit();
  await awaitTxConfirms(lucid, txHash);
  console.log(
    `                               Current time: ${getCurrentTime(lucid)}`,
  );
  console.log(`5 ADA locked into the vesting contract until ${lockedUntil}`);
  console.log(`Tx ID: ${txHash} ${cardanoscanLink(txHash, lucid)}`);

  console.log(`\n=== SETUP WAS SUCCESSFUL ===\n`);

  const vestingUtxo =
    filterUTXOsByTxHash(await lucid.utxosAt(vestingAddress), txHash)[0];

  return {
    vestingValidator: validator,
    vestingAddress: vestingAddress,
    vestingtUtxo: vestingUtxo,
    lockUntil: lockedUntil,
    originalBalance: await getWalletBalanceLovelace(lucid),
    txHash: txHash,
    startTime: startTime,
  };
}

export async function test(gameData: GameData, lucid: Lucid): Promise<boolean> {
  let passed = true;
  console.log("\n================TESTS==================");
  const vestingUtxos = filterUTXOsByTxHash(
    await lucid.utxosAt(gameData.vestingAddress),
    gameData.txHash,
  );
  const endBalance = await getWalletBalanceLovelace(lucid);
  const endTime = getCurrentTime(lucid);
  if (vestingUtxos.length != 0) {
    failTest("TEST 1 FAILED -- the vesting UTxO was not spent");
    passed = false;
  } else {
    passTest("TEST 1 PASSED", lucid);
  }
  if (endBalance - gameData.originalBalance < 4000000n) {
    failTest("TEST 2 FAILED -- your wallet did not obtain additional rewards");
    passed = false;
  } else {
    passTest("TEST 2 PASSED", lucid);
  }
  if (endTime - gameData.startTime > 4 * hour()) {
    failTest(
      "TEST 3 FAILED -- you waited more than 4 hours since the vesting was created",
    );
    passed = false;
  } else {
    passTest("TEST 3 PASSED", lucid);
  }
  if (passed) {
    passAllTests(
      "\nCongratulations on the successful completion of the Level 02: Vesting\nGood luck with the next level.",
      lucid,
    );
    return true;
  } else {
    failTests();
    return false;
  }
}
