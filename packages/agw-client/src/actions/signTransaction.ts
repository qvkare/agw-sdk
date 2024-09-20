import {
  type Account,
  BaseError,
  type Client,
  encodeAbiParameters,
  type Hex,
  parseAbiParameters,
  type Transport,
  type WalletClient,
} from 'viem';
import { getChainId, signTypedData } from 'viem/actions';
import { abstractTestnet } from 'viem/chains';
import { assertCurrentChain, getAction, parseAccount } from 'viem/utils';
import {
  type ChainEIP712,
  type SignEip712TransactionParameters,
  type SignEip712TransactionReturnType,
} from 'viem/zksync';

import {
  assertEip712Request,
  type AssertEip712RequestParameters,
} from '../eip712.js';
import { AccountNotFoundError } from '../errors/account.js';

const ALLOWED_CHAINS: number[] = [abstractTestnet.id];

export async function signTransaction<
  chain extends ChainEIP712 | undefined = ChainEIP712 | undefined,
  account extends Account | undefined = Account | undefined,
  chainOverride extends ChainEIP712 | undefined = ChainEIP712 | undefined,
>(
  client: Client<Transport, ChainEIP712, Account>,
  signerClient: WalletClient<Transport, ChainEIP712, Account>,
  args: SignEip712TransactionParameters<chain, account, chainOverride>,
  validatorAddress: Hex,
  useSignerAddress = false,
): Promise<SignEip712TransactionReturnType> {
  const {
    account: account_ = client.account,
    chain = client.chain,
    ...transaction
  } = args;
  // TODO: open up typing to allow for eip712 transactions
  transaction.type = 'eip712' as any;
  transaction.value = transaction.value
    ? BigInt(transaction.value)
    : (0n as any);

  if (!account_)
    throw new AccountNotFoundError({
      docsPath: '/docs/actions/wallet/signTransaction',
    });
  const smartAccount = parseAccount(account_);
  const fromAccount = useSignerAddress ? signerClient.account : smartAccount;

  assertEip712Request({
    account: smartAccount,
    chain,
    ...(transaction as AssertEip712RequestParameters),
  });

  if (!chain || !ALLOWED_CHAINS.includes(chain.id)) {
    throw new BaseError('Invalid chain specified');
  }

  if (!chain?.custom?.getEip712Domain)
    throw new BaseError('`getEip712Domain` not found on chain.');
  if (!chain?.serializers?.transaction)
    throw new BaseError('transaction serializer not found on chain.');

  const chainId = await getAction(client, getChainId, 'getChainId')({});
  if (chain !== null)
    assertCurrentChain({
      currentChainId: chainId,
      chain: chain,
    });

  const eip712Domain = chain?.custom.getEip712Domain({
    ...transaction,
    chainId,
    from: fromAccount.address,
    type: 'eip712',
  });

  const rawSignature = await signTypedData(signerClient, {
    ...eip712Domain,
    account: signerClient.account,
  });

  let signature;
  if (useSignerAddress) {
    signature = rawSignature;
  } else {
    // Match the expect signature format of the AGW smart account
    signature = encodeAbiParameters(
      parseAbiParameters(['bytes', 'address', 'bytes[]']),
      [rawSignature, validatorAddress, []],
    );
  }

  return chain?.serializers?.transaction(
    {
      chainId,
      ...transaction,
      from: fromAccount.address,
      customSignature: signature,
      type: 'eip712' as any,
    },
    { r: '0x0', s: '0x0', v: 0n },
  ) as SignEip712TransactionReturnType;
}