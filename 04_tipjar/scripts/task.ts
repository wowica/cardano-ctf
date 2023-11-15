import {
  Data,
  Lucid,
  Script,
  SpendingValidator,
  toText,
  UTxO,
} from "https://deno.land/x/lucid@0.10.7/mod.ts";
import {
  awaitTxConfirms,
  cardanoscanLink,
  filterUTXOsByTxHash,
  getWalletBalanceLovelace,
} from "../../common/offchain/utils.ts";
import {
  failTest,
  failTests,
  passAllTests,
  passTest,
} from "../../common/offchain/test_utils.ts";
import { createTipJarDatum, TipJarDatum, TipJarRedeemer } from "./types.ts";
import blueprint from "../plutus.json" assert { type: "json" };

export type Validators = {
  tipJar: SpendingValidator;
  tipJarAddress: string;
};

type GameData = {
  scriptValidator: Script;
  scriptAddress: string;
  scriptUtxo: UTxO;
  originalBalance: bigint;
  lastTx: string | undefined;
};

function readValidators(lucid: Lucid): Validators {
  const tipjar = blueprint.validators.find((v) => v.title === "tipjar.tipjar");

  if (!tipjar) {
    throw new Error("TipJar validator not found");
  }

  const tipJarValidator: Script = {
    type: "PlutusV2",
    script: tipjar.compiledCode,
  };
  const tipJarAddress = lucid.utils.validatorToAddress(tipJarValidator);

  return {
    tipJar: tipJarValidator,
    tipJarAddress: tipJarAddress,
  };
}

export async function setup(lucid: Lucid): Promise<GameData> {
  console.log(`=== SETUP IN PROGRESS ===`);

  // Compile and setup the validators
  const validators = readValidators(lucid);

  const originalBalance = await getWalletBalanceLovelace(lucid);
  console.log(`Your wallet's balance at the beginning is ${originalBalance}`);

  const owner = "1c8d5146716def9ac9aa4968a51e0175cea4e483cb328e48403f0df5";

  console.log("Setting up tipjar!");

  const tx = await lucid!
    .newTx()
    .payToContract(validators!.tipJarAddress, {
      inline: createTipJarDatum(owner, []),
    }, { lovelace: 5000000n })
    .complete();
  const signedTx = await tx.sign().complete();
  const txHash = await signedTx.submit();
  console.log(
    "Setup transaction was submitted, awaiting confirmations!",
  );
  await awaitTxConfirms(lucid, txHash);
  console.log(`Tip Jar was succesfully created, txHash: ${txHash}
        ${cardanoscanLink(txHash, lucid)}`);

  const scriptUtxos = filterUTXOsByTxHash(
    await lucid.utxosAt(validators!.tipJarAddress),
    txHash,
  );

  console.log(`=== SETUP WAS SUCCESSFUL ===`);

  return {
    scriptValidator: validators!.tipJar,
    scriptAddress: validators!.tipJarAddress,
    scriptUtxo: scriptUtxos[0],
    originalBalance: originalBalance,
    lastTx: undefined,
  };
}

async function tryToTip(
  gameData: GameData,
  lucid: Lucid,
  utxo: UTxO,
): Promise<boolean> {
  const validator = gameData.scriptValidator;
  const contract = gameData.scriptAddress;
  const lovelaceInUTxO = utxo.assets["lovelace"];

  if (utxo.datum == null) {
    throw new Error("UTxO object does not contain datum.");
  }

  const datum = Data.from(utxo.datum, TipJarDatum);

  console.log("Trying to tip some more...");
  try {
    const tx = await lucid!
      .newTx()
      .collectFrom([utxo], Data.to("AddTip", TipJarRedeemer))
      .payToContract(contract, {
        inline: createTipJarDatum(
          datum.owner,
          ["Another message for you. We appreciate this CTF very much and hope no one can break it, so that we can tip you many more times in the future. :)"]
            .concat(datum.messages.map(toText)),
        ),
      }, { lovelace: lovelaceInUTxO + 6000000n })
      .attachSpendingValidator(validator)
      .complete();
    const signedTx = await tx.sign().complete();
    await signedTx.submit();
  } catch (e) {
    console.log(e);
    return true;
  }

  return false;
}

export async function test(gameData: GameData, lucid: Lucid) {
  let passed = true;
  console.log("================TESTS==================");

  const endBalance = await getWalletBalanceLovelace(lucid);

  console.log(`Your wallet's balance at the end is ${endBalance}`);

  if (gameData.lastTx == undefined) {
    failTest(
      "YOU FORGOT TO INCLUDE gameData.lastTx, check that you copied player template correctly",
    );
    return false;
  }
  const scriptUtxo = filterUTXOsByTxHash(
    await lucid.utxosAt(gameData.scriptAddress),
    gameData.lastTx,
  )[0];

  // 1. Try to tip to the UTxO
  const tipFailed = await tryToTip(gameData, lucid, scriptUtxo);
  if (tipFailed) {
    passTest(`TEST 1 PASSED - it's not possible to tip anymore!`, lucid);
  } else {
    failTest(`TEST 1 FAILED - tip attempt did not fail.`);
    passed = false;
  }

  // 2. Did not spend too much ADA
  const spentAda = gameData.originalBalance -
    await getWalletBalanceLovelace(lucid);
  console.log(spentAda);
  if (spentAda < 100000000n) {
    passTest(`TEST 1 PASSED - you spent just enough ADA!`, lucid);
  } else {
    failTest(`TEST 1 FAILED - you spent too much ADA.`);
    passed = false;
  }

  if (passed) {
    passAllTests(
      "\nCongratulations on the successful completion of the Level 04: TipJar! Good luck with the next level.",
      lucid,
    );
    return true;
  } else {
    failTests();
    return false;
  }
}
