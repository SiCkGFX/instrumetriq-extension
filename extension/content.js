'use strict';

// Minimal content script: reads a coin symbol from the current page URL only.
// No DOM access. Responds to one message from the popup. Fails silently.

// Slug-to-symbol map for info sites (CoinGecko, CMC, CoinDesk, Messari, DeFiLlama, Kraken prices).
// Generated from twitter_coin_synonyms.json - lowercase base symbol + first brand phrase + known overrides.
var SLUG_TO_SYMBOL={"0g":"0G","0g-token":"0G","1000cat":"1000CAT","1000cheems":"1000CHEEMS","1000sats":"1000SATS","1inch":"1INCH","1inch-network":"1INCH","1mbabydoge":"1MBABYDOGE","2z":"2Z","2z-token":"2Z","a":"A","a2z":"A2Z","a2z-token":"A2Z","aave":"AAVE","aave-token":"AAVE","ach":"ACH","across-protocol":"ACX","act":"ACT","act-token":"ACT","acx":"ACX","ada":"ADA","aevo":"AEVO","aevo-perps":"AEVO","ai-xbt":"AIXBT","ai16z":"AI16Z","aixbt":"AIXBT","akash-network":"AKT","alchemy-pay":"ACH","algo":"ALGO","algorand":"ALGO","alien-worlds":"TLM","allo":"ALLO","allora":"ALLO","alt":"ALT","altlayer":"ALT","anime":"ANIME","anime-token":"ANIME","ape":"APE","apecoin":"APE","api3":"API3","api3-dao":"API3","apt":"APT","aptos":"APT","ar":"AR","arb":"ARB","arbitrum":"ARB","arkham":"ARKM","arkm":"ARKM","arweave":"AR","astar":"ASTER","aster":"ASTER","at":"AT","atom":"ATOM","auction":"AUCTION","avalanche":"AVAX","avax":"AVAX","aventus":"AVNT","avnt":"AVNT","axie-infinity":"AXS","axs":"AXS","baby":"BABY","babydoge-1m":"1MBABYDOGE","banana":"BANANA","banana-token":"BANANA","bananas-31":"BANANAS31","bananas31":"BANANAS31","bank":"BANK","bankless":"BANK","bard":"BARD","bard-ai-token":"BARD","bb":"BB","bch":"BCH","beam-extension":"BEAMX","beamx":"BEAMX","bera":"BERA","berachain":"BERA","bfusd":"BFUSD","big-time":"BIGTIME","bigtime":"BIGTIME","binance-coin":"BNB","bio":"BIO","bio-token":"BIO","bitcoin":"BTC","bitcoin-cash":"BCH","bittensor":"TAO","bluesky":"SKY","blur":"BLUR","blur-marketplace":"BLUR","bm-token":"BMT","bmt":"BMT","bnb":"BNB","bome":"BOME","bonk":"BONK","bonk-token":"BONK","book-of-meme":"BOME","bounce-token":"AUCTION","broccoli-714":"BROCCOLI714","broccoli714":"BROCCOLI714","btc":"BTC","bullieverse-usd":"BFUSD","c":"C","cake":"CAKE","cardano":"ADA","cat":"1000CAT","cati":"CATI","catizen":"CATI","celestia":"TIA","cetus":"CETUS","cetus-protocol":"CETUS","cfx":"CFX","cgpt":"CGPT","chainlink":"LINK","cheems":"1000CHEEMS","chess":"CHESS","chiliz":"CHZ","chz":"CHZ","civic":"CVC","ckb":"CKB","comp":"COMP","compound":"COMP","conflux":"CFX","constitutiondao":"PEOPLE","convex-finance":"CVX","cookie":"COOKIE","cookie-token":"COOKIE","cosmos":"ATOM","coti":"COTI","cow":"COW","cow-protocol":"COW","crv":"CRV","cryptogpt":"CGPT","currency-of-the-internet":"COTI","curve-dao":"CRV","curve-dao-token":"CRV","cvc":"CVC","cvx":"CVX","cyber":"CYBER","cyberconnect":"CYBER","dash":"DASH","dash-token":"DASH","decentraland":"MANA","df":"DF","dforce":"DF","doge":"DOGE","dogecoin":"DOGE","dogs":"DOGS","dogs-token":"DOGS","dogwifhat":"WIF","dolo":"DOLO","dolo-token":"DOLO","dot":"DOT","dydx":"DYDX","dydx-token":"DYDX","dym":"DYM","dymension":"DYM","eden":"EDEN","eden-network":"EDEN","egld":"EGLD","eigen":"EIGEN","eigenlayer":"EIGEN","ena":"ENA","enj":"ENJ","enjin":"ENJ","ens":"ENS","enso":"ENSO","enso-finance":"ENSO","eos":"EOS","epic":"EPIC","epic-token":"EPIC","era":"ERA","etc":"ETC","eth":"ETH","ethena":"ENA","ethena-usd":"USDE","ethereum":"ETH","ethereum-classic":"ETC","ethereum-finance":"ETHFI","ethereum-name-service":"ENS","ethfi":"ETHFI","eul":"EUL","euler":"EUL","eur":"EUR","euri":"EURI","euri-euro":"EURI","euro-stablecoin":"EUR","f":"F","fantom":"FTM","fdusd":"FDUSD","fet":"FET","fetch-ai":"FET","ff":"FF","ff-token":"FF","fil":"FIL","filecoin":"FIL","first-digital-usd":"FDUSD","floki":"FLOKI","floki-inu":"FLOKI","flow":"FLOW","flux":"FLUX","flux-protocol":"FLUX","form":"FORM","formation-finance":"FORM","fun":"FUN","funfair":"FUN","gala":"GALA","gala-token":"GALA","giggle":"GIGGLE","giggle-token":"GIGGLE","gmt":"GMT","gmx":"GMX","gmx-exchange":"GMX","gps":"GPS","gps-token":"GPS","grt":"GRT","gun":"GUN","gun-token":"GUN","haedal":"HAEDAL","haedal-token":"HAEDAL","hamster-kombat-token":"HMSTR","hbar":"HBAR","hedera":"HBAR","hei":"HEI","hei-token":"HEI","helium":"HNT","hemi":"HEMI","hemi-token":"HEMI","hive":"HIVE","hive-blockchain":"HIVE","hmstr":"HMSTR","holo":"HOLO","holochain":"HOLO","home":"HOME","horizen":"ZEN","huma":"HUMA","huma-finance":"HUMA","hyper":"HYPER","hyper-token":"HYPER","hyperliquid":"HYPE","icp":"ICP","idex":"IDEX","idex-exchange":"IDEX","illuvium":"ILV","ilv":"ILV","immutable-x":"IMX","imx":"IMX","init":"INIT","init-token":"INIT","inj":"INJ","injective":"INJ","internet-computer":"ICP","io":"IO","io-net":"IO","iota":"IOTA","jito":"JTO","jito-governance-token":"JTO","jto":"JTO","jup":"JUP","jupiter":"JUP","jupiter-exchange-solana":"JUP","juv":"JUV","juventus-fan-token":"JUV","kaia":"KAIA","kaia-blockchain":"KAIA","kaito":"KAITO","kaito-ai":"KAITO","kamino":"KMNO","kaspa":"KAS","kava":"KAVA","kernel":"KERNEL","kerneldao":"KERNEL","kite":"KITE","kite-token":"KITE","kmno":"KMNO","la":"LA","latoken":"LA","layer":"LAYER","layer-network":"LAYER","layerzero":"ZRO","ldo":"LDO","lido-dao":"LDO","linea":"LINEA","linea-network":"LINEA","link":"LINK","lisk":"LSK","lista":"LISTA","lista-dao":"LISTA","litecoin":"LTC","livepeer":"LPT","lpt":"LPT","lsk":"LSK","ltc":"LTC","magic":"MAGIC","magic-eden-token":"ME","maker":"MKR","manta":"MANTA","manta-network":"MANTA","mantle":"MNT","mantra":"OM","mask":"MASK","mask-network":"MASK","mav":"MAV","maverick-protocol":"MAV","me":"ME","meme":"MEME","memecoin":"MEME","met":"MET","metronome":"MET","mina":"MINA","mina-protocol":"MINA","miota":"IOTA","mira":"MIRA","mira-token":"MIRA","mito":"MITO","mmt":"MMT","monero":"XMR","morpho":"MORPHO","morpho-protocol":"MORPHO","move":"MOVE","movement":"MOVE","movement-labs":"MOVE","mubarak":"MUBARAK","mubarak-token":"MUBARAK","multiversx":"EGLD","mymetatrader":"MMT","near":"NEAR","near-protocol":"NEAR","neiro":"NEIRO","neiro-meme":"NEIRO","neo":"NEO","neo-blockchain":"NEO","nervos":"CKB","newt":"NEWT","newtrino":"NEWT","nil":"NIL","nil-network":"NIL","nmr":"NMR","nom":"NOM","not":"NOT","notcoin":"NOT","numeraire":"NMR","nxpc":"NXPC","nxpc-token":"NXPC","oasis":"ROSE","okb":"OKB","om":"OM","ondo":"ONDO","ondo-finance":"ONDO","onomy":"NOM","ont":"ONT","ontology":"ONT","op":"OP","open":"OPEN","openexchange":"OPEN","optimism":"OP","orca":"ORCA","orca-dex":"ORCA","ordi":"ORDI","ordinals":"ORDI","osmo":"OSMO","osmosis":"OSMO","pancakeswap":"CAKE","parti":"PARTI","parti-protocol":"PARTI","pax-gold":"PAXG","paxg":"PAXG","peanut":"PNUT","pendle":"PENDLE","pendle-finance":"PENDLE","pengu":"PENGU","pengu-meme-coin":"PENGU","people":"PEOPLE","pepe":"PEPE","pepe-meme-coin":"PEPE","pha":"PHA","phala-network":"PHA","pixel":"PIXEL","pixels":"PIXEL","plume":"PLUME","plume-network":"PLUME","pnut":"PNUT","pol":"POL","polkadot":"DOT","polygon":"POL","prove":"PROVE","prove-token":"PROVE","pudgy-penguins":"PENGU","pump":"PUMP","pump-token":"PUMP","pundi-x":"PUNDIX","pundix":"PUNDIX","pyth":"PYTH","pyth-network":"PYTH","qnt":"QNT","qtum":"QTUM","qtum-chain":"QTUM","quant":"QNT","quant-network":"QNT","rare":"RARE","ravencoin":"RVN","ray":"RAY","raydium":"RAY","realio-network-wlfi":"WLFI","red":"RED","render":"RENDER","render-token":"RENDER","renzo":"REZ","reputation-token":"RPL","reserve-rights":"RSR","resolv":"RESOLV","resolv-token":"RESOLV","rez":"REZ","ripple":"XRP","rndr":"RENDER","ronin":"RON","rose":"ROSE","rpl":"RPL","rsr":"RSR","rune":"RUNE","rvn":"RVN","s":"S","saga":"SAGA","saga-token":"SAGA","sahara":"SAHARA","sahara-ai":"SAHARA","sand":"SAND","sapien":"SAPIEN","sapien-network":"SAPIEN","sats":"1000SATS","sei":"SEI","sei-network":"SEI","sextant":"SXT","shell":"SHELL","shell-protocol":"SHELL","shib":"SHIB","shiba-inu":"SHIB","sign":"SIGN","sign-token":"SIGN","skale":"SKL","skl":"SKL","sky":"SKY","snx":"SNX","sol":"SOL","solana":"SOL","solv":"SOLV","solv-protocol":"SOLV","somi":"SOMI","somi-token":"SOMI","soph":"SOPH","sophiaverse":"SOPH","spark":"SPK","spk":"SPK","ssv":"SSV","ssv-network":"SSV","stacks":"STX","staked-usdc":"S","starknet":"STRK","steem":"STEEM","steem-blockchain":"STEEM","stellar":"XLM","stepn-gmt":"GMT","sto":"STO","store-token":"STO","strk":"STRK","stx":"STX","sui":"SUI","sui-network":"SUI","superrare-token":"RARE","sushi":"SUSHI","sushiswap":"SUSHI","sxt":"SXT","syn":"SYN","synapse":"SYN","synthetix":"SNX","syrup":"SYRUP","syrup-token":"SYRUP","t":"T","tao":"TAO","tellor":"TRB","tensor":"TNSR","test-token":"TST","tezos":"XTZ","the":"THE","the-graph":"GRT","the-protocol":"THE","the-sandbox":"SAND","theta":"THETA","theta-network":"THETA","thorchain":"RUNE","threshold-network":"T","tia":"TIA","tlm":"TLM","tnsr":"TNSR","ton":"TON","toncoin":"TON","towns":"TOWNS","townstory-token":"TOWNS","tranchess":"CHESS","trb":"TRB","treasure":"MAGIC","tree":"TREE","tron":"TRX","trump":"TRUMP","trump-coin":"TRUMP","trust-wallet":"TWT","trx":"TRX","tst":"TST","turbo":"TURBO","turbotoad":"TURBO","turtle":"TURTLE","turtle-token":"TURTLE","tut":"TUT","tutankhamun-token":"TUT","twt":"TWT","uma":"UMA","uma-protocol":"UMA","uni":"UNI","uniswap":"UNI","usd1":"USD1","usde":"USDE","usde-usd1":"USD1","usual":"USUAL","usual-protocol":"USUAL","utk":"UTK","utrust":"UTK","vana":"VANA","vana-network":"VANRY","vanry":"VANRY","vechain":"VET","velodrome":"VELODROME","velodrome-finance":"VELODROME","verge":"XVG","vet":"VET","virtual":"VIRTUAL","virtual-protocol":"VIRTUAL","virtuals-protocol":"VIRTUAL","w":"W","wal":"WAL","wal-token":"WAL","wct":"WCT","wif":"WIF","wld":"WLD","wlfi":"WLFI","worldcoin":"WLD","worldcoin-wld":"WLD","wormhole":"W","wormhole-core-token":"WCT","xai":"XAI","xai-network":"XAI","xlm":"XLM","xpl":"XPL","xplus":"XPL","xrp":"XRP","xtz":"XTZ","xvg":"XVG","yb":"YB","yb-token":"YB","ygg":"YGG","yield-guild":"YGG","zbt":"ZBT","zcash":"ZEC","zebec-protocol-token":"ZBT","zec":"ZEC","zen":"ZEN","zk":"ZK","zkc":"ZKC","zkcross":"ZKC","zksync":"ZK","zksync-era":"ERA","zro":"ZRO"};

chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
  if (msg.type !== 'GET_COIN_SYMBOL') {
    sendResponse(null);
    return;
  }
  sendResponse(extractSymbol(window.location.href));
});

function extractSymbol(url) {
  var m;

  // --- Trading sites: extract symbol or pair from URL path/query ---

  // Binance spot: /en/trade/BASE_QUOTE
  m = url.match(/binance\.com\/en\/trade\/([A-Z0-9]+)_[A-Z0-9]+/i);
  if (m) return m[1].toUpperCase();

  // Binance futures: /en/futures/BASEQUOTE (pair_symbols lookup in popup.js)
  m = url.match(/binance\.com\/en\/futures\/([A-Z0-9]+)/i);
  if (m) return m[1].toUpperCase();

  // TradingView: ?symbol=EXCHANGE:BASEQUOTE or ?symbol=BASEQUOTE
  m = url.match(/[?&]symbol=(?:[A-Z0-9_]+:)?([A-Z0-9]+)/i);
  if (m) return m[1].toUpperCase();

  // Bybit: /trade/spot/BASE/QUOTE or /trade/usdt/BASEQUOTE
  m = url.match(/bybit\.com\/trade\/[a-z]+\/([A-Z0-9]+)/i);
  if (m) return m[1].toUpperCase();

  // OKX: /trade-spot/base-quote or /trade-swap/base-quote-swap
  m = url.match(/okx\.com\/trade-[a-z]+\/([A-Z0-9]+)-/i);
  if (m) return m[1].toUpperCase();

  // Coinbase: /advanced-trade/spot/BASE-QUOTE or /advanced-trade/perpetuals/BASE-QUOTE
  m = url.match(/coinbase\.com\/advanced-trade\/[a-z]+\/([A-Z0-9]+)-/i);
  if (m) return m[1].toUpperCase();

  // Kraken Pro: /app/trade/base-quote
  m = url.match(/pro\.kraken\.com\/app\/trade\/([A-Z0-9]+)-/i);
  if (m) return m[1].toUpperCase();

  // Bitget: /spot/BASEQUOTE (pair_symbols lookup)
  m = url.match(/bitget\.com\/spot\/([A-Z0-9]+)/i);
  if (m) return m[1].toUpperCase();

  // KuCoin: /trade/BASE-QUOTE
  m = url.match(/kucoin\.com\/trade\/([A-Z0-9]+)-[A-Z0-9]+/i);
  if (m) return m[1].toUpperCase();

  // Gate.io / Gate.com: /trade/BASE_QUOTE
  m = url.match(/gate\.(?:com|io)\/trade\/([A-Z0-9]+)_[A-Z0-9]+/i);
  if (m) return m[1].toUpperCase();

  // MEXC: /exchange/BASE_QUOTE
  m = url.match(/mexc\.com\/exchange\/([A-Z0-9]+)_[A-Z0-9]+/i);
  if (m) return m[1].toUpperCase();

  // HTX: /trade/base_quote (lowercase in URL)
  m = url.match(/htx\.com\/trade\/([A-Z0-9]+)_[A-Z0-9]+/i);
  if (m) return m[1].toUpperCase();

  // Crypto.com: /exchange/trade/spot/BASE_QUOTE
  m = url.match(/crypto\.com\/exchange\/trade\/[a-z]+\/([A-Z0-9]+)_[A-Z0-9]+/i);
  if (m) return m[1].toUpperCase();

  // Phemex: /spot/trade/BASEQUOTE (pair_symbols lookup)
  m = url.match(/phemex\.com\/spot\/trade\/([A-Z0-9]+)/i);
  if (m) return m[1].toUpperCase();

  // BingX: /en/spot/BASEQUOTE/ (pair_symbols lookup)
  m = url.match(/bingx\.com\/[a-z-]+\/spot\/([A-Z0-9]+)/i);
  if (m) return m[1].toUpperCase();

  // Bitfinex: /t/BASE:QUOTE or /t/BASEQUOTE
  m = url.match(/trading\.bitfinex\.com\/t\/([A-Z0-9]+)[:/]/i);
  if (m) return m[1].toUpperCase();

  // dYdX: /trade/BASE-USD
  m = url.match(/dydx\.exchange\/trade\/([A-Z0-9]+)-/i);
  if (m) return m[1].toUpperCase();

  // --- Info/analytics sites: extract slug, resolve via SLUG_TO_SYMBOL ---

  // CoinGecko: /en/coins/{slug} or /{lang}/coins/{slug}
  m = url.match(/coingecko\.com\/[a-z]+\/coins\/([a-z0-9-]+)/i);
  if (m) return resolveSlug(m[1]);

  // CoinMarketCap: /currencies/{slug}/
  m = url.match(/coinmarketcap\.com\/currencies\/([a-z0-9-]+)/i);
  if (m) return resolveSlug(m[1]);

  // CoinDesk: /price/{slug}
  m = url.match(/coindesk\.com\/price\/([a-z0-9-]+)/i);
  if (m) return resolveSlug(m[1]);

  // CryptoCompare: /coins/{symbol}/overview/QUOTE - symbol directly in URL
  m = url.match(/cryptocompare\.com\/coins\/([a-z0-9]+)\//i);
  if (m) return m[1].toUpperCase();

  // Messari: /project/{slug}
  m = url.match(/messari\.io\/project\/([a-z0-9-]+)/i);
  if (m) return resolveSlug(m[1]);

  // DeFiLlama: /protocol/{slug}
  m = url.match(/defillama\.com\/protocol\/([a-z0-9-]+)/i);
  if (m) return resolveSlug(m[1]);

  // Kraken prices: /prices/{slug}
  m = url.match(/kraken\.com\/prices\/([a-z0-9-]+)/i);
  if (m) return resolveSlug(m[1]);

  return null;
}

function resolveSlug(slug) {
  var lower = slug.toLowerCase();
  return SLUG_TO_SYMBOL[lower] || null;
}
