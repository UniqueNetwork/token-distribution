const fs = require('fs');
var BigNumber = require('bignumber.js');
BigNumber.config({ DECIMAL_PLACES: 18, ROUNDING_MODE: BigNumber.ROUND_DOWN, decimalSeparator: '.' });

////////////////////////////////////////////////////////////////////////////////
// Management audit
airdrop_file = './2021-12/qtz_crowdloan.json';
////////////////////////////////////////////////////////////////////////////////

async function main() {

  const addrs = JSON.parse(fs.readFileSync(airdrop_file));
  let total = addrs.reduce((result, item) => { return result.plus(new BigNumber(item.amount)); }, new BigNumber(0));

  console.log(`Address count: ${addrs.length}`);
  console.log(`Total: ${total.toString()}`);
}

main().catch(console.error).finally(() => process.exit());
