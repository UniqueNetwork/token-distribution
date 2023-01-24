const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
const config = require('./config');
const fs = require('fs');
const delay = require('delay');
var BigNumber = require('bignumber.js');
BigNumber.config({ DECIMAL_PLACES: 18, ROUNDING_MODE: BigNumber.ROUND_DOWN, decimalSeparator: '.' });

const TEST = false;
const seed = config.seed;
const logFile = "./2023/qtz_send_log.txt";
const csvLogFile = "./2023/qtz_send_log.csv";
const decimals = new BigNumber(1e18);
let keyring;
let startAddress = 1; // address list begins with 1

let state = {};

////////////////////////////////////////////////////////////////////////////////
// Management audit
let airdrop_file;
let relay_block_tge = 0;
if (TEST) {
  airdrop_file = './2022-12/qtz_crowdloan_test.json';
  relay_block_tge = 14250;
} else {
  airdrop_file = './2023/qtz-team.json';
  relay_block_tge = 10457457;
}
////////////////////////////////////////////////////////////////////////////////

function log(msg) {
  process.stdout.write(msg);
  fs.appendFileSync(logFile, msg);
}

async function connect() {
  // Initialise the provider to connect to the node
  const wsProvider = new WsProvider(config.wsEndpoint);

  // Create the API and wait until ready
  const defs = require('@unique-nft/quartz-mainnet-types/definitions');
  const api = await ApiPromise.create({
    provider: wsProvider,
    rpc: { unique: defs.unique.rpc }
  });

  return api;
}

function getTransactionStatus(events, status) {
  if (status.isReady) {
    return "NotReady";
  }
  if (status.isBroadcast) {
    return "NotReady";
  }
  if (status.isRetracted) {
    return "Retracted";
  }
  if (status.isInBlock || status.isFinalized) {
    if(events.filter(e => e.event.data.method === 'ExtrinsicFailed').length > 0) {
      return "Fail";
    }
    if(events.filter(e => e.event.data.method === 'ExtrinsicSuccess').length > 0) {
      return "Success";
    }
  }

  return "Fail";
}

function sendTransactionAsync(sender, transaction) {
  // if (TEST) {
  //   log(`OK\n`);
  //   return;
  // }
  // else {
    return new Promise(async (resolve, reject) => {
      try {
        // 10 blocks with no result => timeout and keep going
        const timeoutID = setTimeout(() => {
          log(`Transaction timeout\n`);
          reject(null);
        }, 10 * 12 * 1000);

        let unsub = await transaction.signAndSend(sender, ({ events = [], status }) => {
          const transactionStatus = getTransactionStatus(events, status);

          if (transactionStatus === "Success") {
            let blockHash = '';
            if (status.isInBlock) blockHash = status.asInBlock;
            if (status.isFinalized) blockHash = status.asFinalized;
            log(`OK in block ${blockHash}\n`);
            resolve(blockHash);
            unsub();
            clearTimeout(timeoutID);
          } else if (transactionStatus === "NotReady") {
          } else if (transactionStatus === "Retracted") {
            log(`Retracted ... `);
            // keep waiting
          } else {
            log(`Tx failed. Status: ${status}\n`);
            resolve(null);
            unsub();
            clearTimeout(timeoutID);
          }
        });
      } catch (e) {
        log('Error: ' + e.toString() + '\n');
        resolve(null);
      }
    });
  // }
}

async function sendVestedFunds(i, api, sender, recipient, amount, lock, vest) {
  const amount1StrHuman = (new BigNumber(1)).toFixed();
  const amount1Str = (new BigNumber(1)).times(decimals).toString();
  const amount2StrHuman = (new BigNumber(amount-1)).toFixed();
  const amountPerPeriodStr = (new BigNumber(amount-1)).times(decimals).div(vest).integerValue().toString();

  // Log for audit records
  const recipientKusama = keyring.encodeAddress(keyring.decodeAddress(recipient), 2);
  fs.appendFileSync(csvLogFile, `${recipientKusama},${recipient},${amount},${amount1StrHuman},${relay_block_tge},${lock},${vest},${amountPerPeriodStr},`);

  // 1. Send 1 coin as regular transfer
  log(`${i}: Transfer ${amount1StrHuman} to ${recipient} ... `);
  const tx1 = api.tx.balances.transfer(recipient, amount1Str);
  const blockHash1 = await sendTransactionAsync(sender, tx1);

  // Log for audit
  fs.appendFileSync(csvLogFile, `${blockHash1},`);

  // 2. Send the rest as vested transfer
  log(`${i}: Vesting ${amount2StrHuman} to ${recipient} ... `);
  const tx2 = api.tx.vesting.vestedTransfer(recipient, {
    start: relay_block_tge + lock,
    period: 1,
    periodCount: vest,
    perPeriod: amountPerPeriodStr
  });
  const blockHash2 = await sendTransactionAsync(sender, tx2);

  // Log for audit records
  fs.appendFileSync(csvLogFile, `${blockHash2}\n`);
}

function saveState() {
  fs.writeFileSync("./state.json", JSON.stringify(state));
}

function loadState() {
  try {
    state = JSON.parse(fs.readFileSync("./state.json"));
  } catch (e) {
    if (!e.toString().includes('no such file')) throw e;
  }
  if (state[airdrop_file] == undefined) {
    state[airdrop_file] = 1;
    startAddress = 1;
  }
  else {
    startAddress = state[airdrop_file];
  }
}

async function main() {

  const api = await connect();

  keyring = new Keyring({ type: 'sr25519' });
  keyring.setSS58Format(255);
  const sender = keyring.addFromUri(seed);

  const addrs = JSON.parse(fs.readFileSync(airdrop_file));
  loadState();

  console.log(`===========================================================`);
  console.log(`------- START`);
  console.log(`Number of addresses: ${addrs.length}`);
  console.log(`Sender Address: ${sender.address}`);
  console.log(`Test mode: ${TEST}`);
  console.log(`Network: ${config.wsEndpoint}`);

  // Total to be distributed
  let total = 0;
  for (let i=startAddress; i<=addrs.length; i++) {
    total += addrs[i-1].amount;
  }
  console.log(`Total to be distributed: ${total}`);
  console.log(`Starting with recipient #: ${startAddress}`);

  const balance = new BigNumber((await api.query.system.account(sender.address)).data.free);
  console.log(`Sender initial balance: ${balance.div(decimals).toString()}`);

  if (startAddress <= addrs.length) {
    let d = 30;
    while (d>0) {
      process.stdout.write(`WARNING: Will start with address ${startAddress} (${addrs[startAddress-1].recipient}) in ${d} seconds ...            \r`);
      await delay(1000);
      d--;
    }
    console.log("                                                                                                                                  ");
  }
  else {
    console.log("Nothing to distribute");
  }

  for (let i=startAddress; i<=addrs.length; i++) {
    if (i == 1) fs.appendFileSync(csvLogFile, `KSM Address,QTZ Address,QTZ Total Amount,Transferrable Amount,TGE Block,Lock blocks,Vesting Blocks,Amount per block,Transfer tx hash,Vesting tx hash\n`);
    try {
      const recipient = keyring.encodeAddress(keyring.decodeAddress(addrs[i-1].recipient), 255);
      const amount = addrs[i-1].amount;
      const lock = addrs[i-1].lockBlocks;
      const vest = addrs[i-1].vestingBlocks;
      await sendVestedFunds(i, api, sender, recipient, amount, lock, vest);
    }
    catch (e) {
      log('Error: ' + e.toString() + '\n');
      process.exit();
    }

    state[airdrop_file] = i+1;
    saveState();

    // Graceful interruption
    try {
      const { stop } = JSON.parse(fs.readFileSync("./stop.json"));
      if (stop) break;
    } catch (e) {}
  }
}

main().catch(console.error).finally(() => process.exit());

// const blockNumber = 100000;
// const blockHash = await api.rpc.chain.getBlockHash(blockNumber);
// const signedBlock = await api.rpc.chain.getBlock(blockHash);
// console.log(`Block ${blockNumber} hash: ${signedBlock.block.header.hash.toHex()}`);