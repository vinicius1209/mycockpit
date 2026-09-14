import json,os,pathlib,signal,subprocess,time,sys
root=pathlib.Path(sys.argv[1]).resolve(); cwd=root/'workspace'; label=sys.argv[2]
prompt=(root/(label+'.prompt.txt')).read_text()
args=['agy','-p',prompt,'--output-format','stream-json','--print-timeout','4m','--add-dir',str(cwd),'--model','gemini-3.8-flash-high','--dangerously-skip-permissions']
if len(sys.argv)>3: args+=['--conversation',sys.argv[3]]
env={k:v for k,v in os.environ.items() if not k.startswith(('MYCOCKPIT_','FROTA_'))}
(root/(label+'.argv.json')).write_text(json.dumps(args))
start=time.monotonic(); seen=set(); samples=[]; why=None
with (root/(label+'.jsonl')).open('wb') as out,(root/(label+'.stderr')).open('wb') as err:
 p=subprocess.Popen(args,cwd=cwd,env=env,stdin=subprocess.DEVNULL,stdout=out,stderr=err,start_new_session=True)
 while p.poll() is None:
  rows={}
  for line in subprocess.check_output(['ps','-axo','pid=,ppid=,rss=,pcpu=,comm='],text=True).splitlines():
   fields=line.strip().split(None,4)
   if len(fields)==5:
    pid,ppid,rss,cpu,comm=fields; rows[int(pid)]={'pid':int(pid),'ppid':int(ppid),'rss_kib':int(rss),'cpu':float(cpu),'comm':comm}
  family={p.pid}
  while True:
   new={pid for pid,row in rows.items() if row['ppid'] in family}
   if new<=family: break
   family|=new
  seen|=family
  samples.append({'elapsed':round(time.monotonic()-start,2),'processes':[rows[x] for x in family if x in rows]})
  marker=cwd/'cancel.pid'
  if label=='cancel' and marker.exists() and time.time()-marker.stat().st_mtime>2: why='intentional_cancel'
  if time.monotonic()-start>250: why='harness_timeout'
  if why:
   os.killpg(p.pid,signal.SIGTERM)
   try:p.wait(timeout=5)
   except subprocess.TimeoutExpired: os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=5)
   break
  time.sleep(1)
 result={'label':label,'pid':p.pid,'exit':p.returncode,'elapsed':round(time.monotonic()-start,2),'termination':why,'peak_root_rss_kib':max((next((x['rss_kib'] for x in s['processes'] if x['pid']==p.pid),0) for s in samples),default=0),'peak_tree_rss_kib':max((sum(x['rss_kib'] for x in s['processes']) for s in samples),default=0)}
 time.sleep(2)
 remaining=[]
 for pid in seen-{p.pid}:
  try: os.kill(pid,0);remaining.append(pid)
  except ProcessLookupError: pass
 result['remaining_observed_pids']=remaining
 # Somente descendentes observados desta execução, sem atingir runs do app.
 for pid in remaining:
  try:os.kill(pid,signal.SIGTERM)
  except ProcessLookupError:pass
 (root/(label+'.memory.json')).write_text(json.dumps(samples))
 (root/(label+'.summary.json')).write_text(json.dumps(result,indent=2))
 print(json.dumps(result),flush=True)
