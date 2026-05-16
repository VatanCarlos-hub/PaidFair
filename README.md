# PaidFair — Know Your Worth

A salary intelligence dApp built on GenLayer testnet. Users enter their profession, region, years of experience and current salary — multiple AI validators reach on-chain consensus on whether the salary is fair, below or above market, and provide negotiation advice.

## Project Structure

```
PaidFair/
├── index.html        # HTML structure
├── css/
│   └── styles.css    # All styles
├── js/
│   └── app.js        # GenLayer client, wallet connection, contract interaction
└── README.md
```

## How It Works

1. User connects MetaMask wallet (GenLayer Studio testnet)
2. Fills in job title, work region, years of experience, optional current salary
3. Transaction is sent to the smart contract `analyze_salary`
4. Multiple AI validators independently process the query and reach consensus (~2–3 min)
5. Result is fetched via `get_result` and rendered on-page

## Contract

- **Address:** `0x94582C426DCf506796546520255F33d1b0367244`
- **Network:** GenLayer Studio Testnet (`chainId: 0xf22f`)
- **RPC:** `https://studio.genlayer.com/api`

## Stack

- Vanilla HTML / CSS / JS (no framework)
- [genlayer-js](https://www.npmjs.com/package/genlayer-js) via esm.sh
- MetaMask for wallet connection
