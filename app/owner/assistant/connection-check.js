'use client';
import {useState,useRef} from 'react';
export default function ConnectionTest(){
 const [state,setState]=useState(''),[busy,setBusy]=useState(false),lock=useRef(false);
 async function test(){if(lock.current)return;lock.current=true;setBusy(true);setState('');try{
  const result=await fetch('/api/owner/assistant/diagnostics',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  const body=await result.json();setState(result.ok?'success':result.status===429?'limit':['missing_config','provider_auth','provider_unavailable','invalid_response'].includes(body.error)?body.error:'provider_unavailable');
 }catch{setState('provider_unavailable')}finally{lock.current=false;setBusy(false)}}
 const copy={success:'Connection succeeded. This does not verify permissions or production readiness.',missing_config:'The selected provider needs server-side configuration.',provider_auth:'The provider rejected authentication. Check the server-side key.',provider_unavailable:'The provider is unavailable. Check the connection and try later.',invalid_response:'The provider returned an unsupported or incomplete response.',limit:'The request limit has been reached.'};
 return <div className="connection-test"><button className="btn light" type="button" disabled={busy} onClick={test}>{busy?'Checking…':'Test connection'}</button><p className="form-note">Uses one request from the workspace quota and may incur provider charges. No business data is sent.</p>{state&&<p role="status" className={state==='success'?'intake-success':'form-error'}>{copy[state]}</p>}</div>;
}
