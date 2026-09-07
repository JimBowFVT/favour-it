import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import FoundingCreators from './FoundingCreators';
import AdminFoundingCreators, { applicationCsv } from './AdminFoundingCreators';
import { getAttribution, isFoundingPath, submitApplication, validateApplication } from './programme';

const valid = { name:'Test Creator',email:'creator@example.com',area:'Visual design',offer:'A review of five portfolio pages and three improvements.',need:'An edit of my portfolio introduction video this month.',portfolio:'https://example.com/portfolio',availability:'Two hours next week',pilotConsent:true,contactConsent:true,adultConsent:true,digestConsent:false };
function clientFor(open = false, result = {data:{received:true},error:null}) {
  return {rpc:jest.fn((name)=>Promise.resolve(name==='get_founding_programme'?{data:{applications_open:open,founder_name:'Adam Levi',contact_email:'adamzoharlevi@gmail.com'},error:null}:result))};
}
test('only the explicit marketing route replaces the app route',()=>{
  expect(isFoundingPath('/founding-creators/')).toBe(true);
  for(const path of ['/','/adminpanel','/middleman','/founding-creators-extra']) expect(isFoundingPath(path)).toBe(false);
});
test('attribution is bounded campaign metadata, not an arbitrary URL or user payload',()=>{
  expect(getAttribution('?utm_source=linked%20in&utm_campaign=founding&token=secret')).toEqual({source:'linkedin',medium:'',campaign:'founding',referral:''});
  expect(getAttribution('?utm_source='+'x'.repeat(100)).source).toHaveLength(80);
});
test('the form requires informed consent, a specific need, and a safe portfolio URL',()=>{
  expect(validateApplication(valid)).toEqual({});
  expect(validateApplication({...valid,pilotConsent:false,contactConsent:false,adultConsent:false,need:'anything',portfolio:'javascript:alert(1)'})).toMatchObject({pilotConsent:expect.any(String),contactConsent:expect.any(String),adultConsent:expect.any(String),need:expect.any(String),portfolio:expect.any(String)});
  expect(validateApplication({...valid,portfolio:'https://user:pass@example.com'}).portfolio).toBeTruthy();
});
test('missing backend and unexpected responses never claim receipt',async()=>{
  await expect(submitApplication(null,valid,{})).rejects.toThrow('Nothing has been sent');
  await expect(submitApplication({rpc:async()=>({data:{},error:null})},valid,{})).rejects.toThrow('not confirmed');
});
test('closed intake shows the restriction and cannot submit',async()=>{
  const client=clientFor(false);render(<FoundingCreators client={client}/>);
  await waitFor(()=>expect(client.rpc).toHaveBeenCalledWith('get_founding_programme'));
  expect(screen.getByRole('button',{name:'Applications opening after research'})).toBeDisabled();
  expect(screen.getAllByText(/Cash-out is unavailable during this pilot/).length).toBeGreaterThan(0);
  expect(client.rpc).toHaveBeenCalledTimes(1);
});
async function fillForm(){
  fireEvent.change(screen.getByLabelText('Your name'),{target:{value:valid.name}});
  fireEvent.change(screen.getByLabelText('Email'),{target:{value:valid.email}});
  fireEvent.change(screen.getByLabelText('Your main service area'),{target:{value:valid.area}});
  fireEvent.change(screen.getByLabelText('One service I can offer'),{target:{value:valid.offer}});
  fireEvent.change(screen.getByLabelText('One service I need in the next 30 days'),{target:{value:valid.need}});
  fireEvent.change(screen.getByLabelText('Link to your work'),{target:{value:valid.portfolio}});
  fireEvent.change(screen.getByLabelText('When could you participate?'),{target:{value:valid.availability}});
  fireEvent.click(screen.getByLabelText(/I understand that FAV/));
  fireEvent.click(screen.getByLabelText(/Favourit may use these details/));
  fireEvent.click(screen.getByLabelText(/I am at least 18/));
}
test('receipt is shown only after confirmed storage, with digest opt-in left false',async()=>{
  const client=clientFor(true);render(<FoundingCreators client={client}/>);
  await screen.findByRole('button',{name:'Send my application ↗'});await fillForm();
  fireEvent.click(screen.getByRole('button',{name:'Send my application ↗'}));
  await screen.findByText('APPLICATION RECEIVED');
  expect(client.rpc).toHaveBeenCalledWith('submit_founding_application',expect.objectContaining({p_application:expect.objectContaining({digest_consent:false,contact_consent:true,consent_version:'founding-creators-2026-09-07'})}));
});
test('backend failure preserves form contents and permits retry',async()=>{
  const client=clientFor(true,{data:null,error:{message:'Applications are not open yet.'}});render(<FoundingCreators client={client}/>);
  await screen.findByRole('button',{name:'Send my application ↗'});await fillForm();
  fireEvent.click(screen.getByRole('button',{name:'Send my application ↗'}));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Your name')).toHaveValue(valid.name);
  expect(screen.queryByText('APPLICATION RECEIVED')).not.toBeInTheDocument();
});
test('spreadsheet exports neutralise formula injection and quote CSV contents',()=>{
  const csv=applicationCsv([{name:'=HYPERLINK("bad")',offer:'one, two',notes:'\t=1+1'}]);
  expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
  expect(csv).toContain('"one, two"');
  expect(csv).toContain('"\'\t=1+1"');
});

test('admin exports wait for saved reviews and withdrawal clears digest consent',async()=>{
  const row={id:'application-1',name:'Test Creator',email:'creator@example.com',area:'Writing',created_at:'2026-09-07T00:00:00Z',status:'applied',notes:'',digest_consent:true};
  const client={rpc:jest.fn(name=>Promise.resolve({data:name==='admin_list_founding_applications'?[row]:name==='get_founding_programme'?{applications_open:false}:null,error:null}))};
  render(<AdminFoundingCreators client={client}/>);
  const exportButton=await screen.findByRole('button',{name:'Export displayed applications'});
  expect(exportButton).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Status'),{target:{value:'withdrawn'}});
  expect(exportButton).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Save review'}));
  await screen.findByText('Review saved.');
  expect(exportButton).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Status'),{target:{value:'waitlisted'}});
  expect(screen.getByText(/Digest: not opted in/)).toBeInTheDocument();
});
