const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
const config = require('./config');
const fs = require('fs');
var BigNumber = require('bignumber.js');
BigNumber.config({ DECIMAL_PLACES: 18, ROUNDING_MODE: BigNumber.ROUND_DOWN, decimalSeparator: '.' });

const TEST = true;
const seed = config.seed;
const logFile = "./2021-12/qtz_send_log.txt";
const csvLogFile = "./2021-12/qtz_send_log.csv";
const decimals = new BigNumber(1e18);
let keyring;

////////////////////////////////////////////////////////////////////////////////
// Management audit
let airdrop_file;
let relay_block_tge = 0;
if (TEST) {
  airdrop_file = './2021-12/qtz_crowdloan_test.json';
  relay_block_tge = 14250;
} else {
  airdrop_file = './2021-12/qtz_crowdloan.json';
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
  const defs = require('@unique-nft/types/definitions');
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
        setTimeout(() => { 
          log(`Transaction timeout\n`);
          resolve(null);
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
          } else if (transactionStatus === "NotReady") {
          } else if (transactionStatus === "Retracted") {
            log(`Retracted ... `);
            // keep waiting
          } else {
            log(`Tx failed. Status: ${status}\n`);
            resolve(null);
            unsub();
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

  // 1. Send 1 coin as regular transfer
  log(`${i}: Transfer ${amount1StrHuman} to ${recipient} ... `);
  const tx1 = api.tx.balances.transfer(recipient, amount1Str);
  const blockHash1 = await sendTransactionAsync(sender, tx1);

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
  const recipientKusama = keyring.encodeAddress(keyring.decodeAddress(recipient), 2);
  fs.appendFileSync(csvLogFile, `${recipientKusama},${recipient},${amount},${amount1StrHuman},${relay_block_tge},${lock},${vest},${amountPerPeriodStr},${blockHash1},${blockHash2}\n`);
}

async function main() {

  const api = await connect();

  keyring = new Keyring({ type: 'sr25519' });
  keyring.setSS58Format(255);
  const sender = keyring.addFromUri(seed);

  const addrs = JSON.parse(fs.readFileSync(airdrop_file));
  
  log(`===========================================================\n`);
  log(`------- START\n`);
  log(`Number of addresses: ${addrs.length}\n`);
  log(`Sender Address: ${sender.address}\n`);
  log(`Test mode: ${TEST}\n`);
  log(`Network: ${config.wsEndpoint}\n`);
  fs.appendFileSync(csvLogFile, `KSM Address,QTZ Address,QTZ Total Amount,Transferrable Amount,TGE Block,Lock blocks,Vesting Blocks,Amount per block,Transfer tx hash,Vesting tx hash\n`);

  const balance = new BigNumber((await api.query.system.account(sender.address)).data.free);
  log(`Sender initial balance: ${balance.div(decimals).toString()}\n`);

  for (let i=1; i<=addrs.length; i++) {
    try {
      const recipient = keyring.encodeAddress(keyring.decodeAddress(addrs[i-1].recipient), 255);
      const amount = addrs[i-1].amount;
      const lock = addrs[i-1].lockBlocks;
      const vest = addrs[i-1].vestingBlocks;
      await sendVestedFunds(i, api, sender, recipient, amount, lock, vest);
    }
    catch (e) {
      log('Error: ' + e.toString() + '\n');
    }
  }
}

main().catch(console.error).finally(() => process.exit());
