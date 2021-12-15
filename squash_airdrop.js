const fs = require('fs');
var BigNumber = require('bignumber.js');
BigNumber.config({ DECIMAL_PLACES: 18, ROUNDING_MODE: BigNumber.ROUND_DOWN, decimalSeparator: '.' });

////////////////////////////////////////////////////////////////////////////////
// Management audit
const airdrop_file = './2021-12/qtz_crowdloan_raw.json';
const airdrop_file_squashed = './2021-12/qtz_crowdloan.json';
////////////////////////////////////////////////////////////////////////////////

async function main() {

  const addrs = JSON.parse(fs.readFileSync(airdrop_file));
  let total = new BigNumber(0);

  let squashedObj = {};
  for (let i=1; i<=addrs.length; i++) {
    const recipient = addrs[i-1].recipient;
    const amount = new BigNumber(addrs[i-1].amount);
    const lock = addrs[i-1].lockBlocks;
    const vest = addrs[i-1].vestingBlocks;
    total = total.plus(amount);

    if (squashedObj[recipient]) {
      squashedObj[recipient].amount = squashedObj[recipient].amount.plus(amount);
    }
    else {
      squashedObj[recipient] = {
        amount: amount,
        lockBlocks: lock,
        vestingBlocks: vest
      }
    }
  }

  fs.writeFileSync(airdrop_file_squashed, "[\n");
  let count = 0;
  let keyCount = Object.keys(squashedObj).length;
  for (r in squashedObj) {
    const addr = {
      recipient: r,
      amount: squashedObj[r].amount.toString(),
      lockBlocks: squashedObj[r].lockBlocks,
      vestingBlocks: squashedObj[r].vestingBlocks
    };
    fs.appendFileSync(airdrop_file_squashed, JSON.stringify(addr) + `${count < keyCount-1 ? ',':''}\n`);
    count++;
  }
  fs.appendFileSync(airdrop_file_squashed, "]\n");

  console.log(`Squashing recipient addresses`)
  console.log(`Original entries: ${addrs.length}`)
  console.log(`Unique addresses: ${keyCount}`)
  console.log(`Total: ${total.toString()}`)
}

main().catch(console.error).finally(() => process.exit());
