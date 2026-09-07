import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CryptoWalletPanel from './CryptoWalletPanel';
import { getMyFavBalanceBreakdown } from '../lib/wallet';
import { getCryptoChainStatus, getMyCryptoEligibility, getMyCryptoWallet, getMyCryptoUnlocks, getCryptoUnlockByClientId, requestCryptoUnlock, acceptCryptoConsent } from '../lib/crypto';
import { readUnlockAttempt } from '../lib/cryptoRecovery';
jest.mock('../lib/wallet', () => ({ ...jest.requireActual('../lib/wallet'), getMyFavBalanceBreakdown: jest.fn() }));
jest.mock('../lib/crypto', () => ({ ...jest.requireActual('../lib/crypto'), getCryptoChainStatus:jest.fn(),getMyCryptoEligibility:jest.fn(), getMyCryptoWallet:jest.fn(),getMyCryptoUnlocks:jest.fn(),getCryptoUnlockByClientId:jest.fn(), requestCryptoUnlock:jest.fn(), acceptCryptoConsent:jest.fn() }));
const userId='member-a';const address=`0x${'1'.repeat(40)}`;const requestId='11111111-1111-4111-8111-111111111111';
const chain={chain_id:84532,token_address:address,minter_address:address,deployment_verified_at:'2026-09-07',unlock_enabled:true};
const funds={crypto_eligible_fav:'10000000',crypto_maturing_fav:'0',pending_crypto_unlock_fav:'0',crypto_unlock_fee_bps:250,crypto_unlock_maturity_hours:120};
beforeEach(()=>{
 jest.clearAllMocks();localStorage.clear();
 Object.defineProperty(window,'crypto',{configurable:true,value:{randomUUID:()=>requestId}});
 getCryptoChainStatus.mockResolvedValue(chain);getMyCryptoEligibility.mockResolvedValue({is_adult:true,crypto_eligible:true,crypto_consent_required:false});
 getMyCryptoWallet.mockResolvedValue({wallet_address:address,is_active:true,verified_at:'2026-09-07'});
 getMyFavBalanceBreakdown.mockResolvedValue(funds);getMyCryptoUnlocks.mockResolvedValue([]);getCryptoUnlockByClientId.mockResolvedValue(null);
});
async function enterAmount(){fireEvent.change(await screen.findByLabelText('Amount to unlock'),{target:{value:'1'}});}
test('an ambiguous unlock survives unmount and retries the identical saved request',async()=>{
 requestCryptoUnlock.mockRejectedValueOnce(new Error('Network response lost')).mockResolvedValueOnce({id:'server-request',status:'pending'});
 const first=render(<CryptoWalletPanel userId={userId}/>);await enterAmount();
 fireEvent.click(screen.getByRole('button',{name:'Queue crypto unlock'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Network response lost');
 expect(readUnlockAttempt(localStorage,userId).id).toBe(requestId);
 first.unmount();render(<CryptoWalletPanel userId={userId}/>);
 const retry=await screen.findByRole('button',{name:'Check / retry saved request'});
 await waitFor(()=>expect(retry).toBeEnabled());fireEvent.click(retry);
 await waitFor(()=>expect(requestCryptoUnlock).toHaveBeenCalledTimes(2));
 expect(requestCryptoUnlock.mock.calls[0]).toEqual([1000000,requestId,userId]);
 expect(requestCryptoUnlock.mock.calls[1]).toEqual(requestCryptoUnlock.mock.calls[0]);
 await waitFor(()=>expect(readUnlockAttempt(localStorage,userId)).toBeNull());
 await waitFor(()=>expect(screen.getByRole('button',{name:'Refresh crypto status'})).toBeEnabled());
});
test('a request already recorded by the server is reconciled without sending it again',async()=>{
 localStorage.setItem(`favourit:crypto-unlock-attempt:v1:${userId}`,JSON.stringify({id:requestId,userId,address,chainId:84532,amount:'1000000'}));
 getCryptoUnlockByClientId.mockResolvedValue({id:'recorded',status:'confirmed'});
 render(<CryptoWalletPanel userId={userId}/>);
 expect(await screen.findByText(/Your earlier request is recorded/)).toBeInTheDocument();
 expect(requestCryptoUnlock).not.toHaveBeenCalled();expect(readUnlockAttempt(localStorage,userId)).toBeNull();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Refresh crypto status'})).toBeEnabled());
});
test('explicit database rejection clears the pending attempt without a fabricated receipt',async()=>{
 requestCryptoUnlock.mockRejectedValue({code:'P0001',message:'insufficient available FAV'});
 render(<CryptoWalletPanel userId={userId}/>);await enterAmount();fireEvent.click(screen.getByRole('button',{name:'Queue crypto unlock'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('insufficient');
 expect(readUnlockAttempt(localStorage,userId)).toBeNull();
 expect(screen.queryByText(/Request recorded:/)).not.toBeInTheDocument();
});
test.each([{chain_id:1},{minter_address:null},{unlock_enabled:false}])('chain safeguards remain closed for %s',async override=>{
 getCryptoChainStatus.mockResolvedValue({...chain,...override});render(<CryptoWalletPanel userId={userId}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Refresh crypto status'})).toBeEnabled());
 const button=screen.queryByRole('button',{name:'Queue crypto unlock'});if(button) expect(button).toBeDisabled();
 expect(requestCryptoUnlock).not.toHaveBeenCalled();
});
test('crypto consent requires an explicit opt-in and does not establish eligibility',async()=>{
 getMyCryptoEligibility.mockResolvedValue({is_adult:true,crypto_eligible:false,crypto_consent_required:true});
 acceptCryptoConsent.mockResolvedValue({crypto_eligible:false});render(<CryptoWalletPanel userId={userId}/>);
 const record=await screen.findByRole('button',{name:'Record my crypto consent'});expect(record).toBeDisabled();
 expect(acceptCryptoConsent).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(record);
 await waitFor(()=>expect(acceptCryptoConsent).toHaveBeenCalledWith(userId));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Verify a different wallet'})).toBeDisabled());
 await waitFor(()=>expect(screen.getByRole('button',{name:'Refresh crypto status'})).toBeEnabled());
});
