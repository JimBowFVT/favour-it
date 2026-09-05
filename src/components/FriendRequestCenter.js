import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getMySocialGraph } from '../lib/social';
import './FriendRequestCenter.css';

function openRequests(){
  const button=[...document.querySelectorAll('.community-tabs button')].find(node=>node.textContent?.trim().startsWith('Requests'));
  if(button){button.click();return true;}
  const nav=[...document.querySelectorAll('button,a')].find(node=>node.textContent?.trim()==='Community');
  if(nav){nav.click();setTimeout(()=>{const next=[...document.querySelectorAll('.community-tabs button')].find(node=>node.textContent?.trim().startsWith('Requests'));next?.click();},80);return true;}
  return false;
}

export default function FriendRequestCenter(){
  const [incoming,setIncoming]=useState([]),[toast,setToast]=useState(null);const seen=useRef(new Set());
  const refresh=async()=>{try{const graph=await getMySocialGraph();setIncoming(Array.isArray(graph?.incoming)?graph.incoming:[]);}catch(_){}};
  useEffect(()=>{refresh();if(!supabase)return undefined;const channel=supabase.channel('friend-request-notifications').on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications'},payload=>{const row=payload.new;if(!row||row.type!=='friend_request')return;if(seen.current.has(row.id))return;seen.current.add(row.id);setToast({id:row.id,title:row.title||'New friend request',body:row.body||'Someone sent you a friend request.'});refresh();window.dispatchEvent(new CustomEvent('favourit:friend-request-updated'));}).subscribe();const timer=window.setInterval(refresh,12000);return()=>{window.clearInterval(timer);try{supabase.removeChannel(channel);}catch(_){}};},[]);
  useEffect(()=>{if(!toast)return undefined;const timer=window.setTimeout(()=>setToast(null),7000);return()=>window.clearTimeout(timer);},[toast]);
  useEffect(()=>{const mark=()=>refresh();window.addEventListener('favourit:friend-request-updated',mark);const open=()=>openRequests();window.addEventListener('favourit:open-community-requests',open);return()=>{window.removeEventListener('favourit:friend-request-updated',mark);window.removeEventListener('favourit:open-community-requests',open);};},[]);
  if(!toast&&!incoming.length)return null;
  return toast?<button className="friend-request-toast" type="button" onClick={()=>{openRequests();setToast(null);}}><span className="friend-request-toast-avatar">♡</span><span><strong>{toast.title}</strong><small>{toast.body}</small></span></button>:null;
}

export function FriendRequestBadge(){
  const [count,setCount]=useState(0);const refresh=async()=>{try{const graph=await getMySocialGraph();setCount(Array.isArray(graph?.incoming)?graph.incoming.length:0);}catch(_){}};
  useEffect(()=>{refresh();const timer=window.setInterval(refresh,12000);const listener=()=>refresh();window.addEventListener('favourit:friend-request-updated',listener);return()=>{window.clearInterval(timer);window.removeEventListener('favourit:friend-request-updated',listener);};},[]);
  useEffect(()=>{const sync=()=>{const tabs=document.querySelectorAll('.community-tabs button');tabs.forEach(button=>{if(button.textContent?.trim().startsWith('Requests')){let badge=button.querySelector('.friend-request-count');if(!count){badge?.remove();return;}if(!badge){badge=document.createElement('span');badge.className='friend-request-count';button.appendChild(badge);}badge.textContent=count>99?'99+':String(count);}});};sync();const observer=new MutationObserver(sync);observer.observe(document.body,{childList:true,subtree:true});return()=>observer.disconnect();},[count]);
  return null;
}
