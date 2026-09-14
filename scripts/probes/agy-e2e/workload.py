import hashlib,json,os,pathlib,sys,time
root=pathlib.Path(__file__).parent
mode=sys.argv[1]
if mode=='volume':
 data='.'*142976
 hold=bytearray(24*1024*1024)
 print('FROTA_E2E_BEGIN',flush=True)
 print(data,flush=True)
 time.sleep(12)
 receipt={'mode':mode,'dots':len(data),'sha256':hashlib.sha256(data.encode()).hexdigest(),'pid':os.getpid(),'marker':'FROTA_E2E_VOLUME_DONE'}
 (root/'receipt.json').write_text(json.dumps(receipt))
 print(json.dumps(receipt),flush=True)
elif mode=='cancel':
 (root/'cancel.pid').write_text(str(os.getpid()))
 print('FROTA_E2E_CANCEL_STARTED',flush=True)
 for i in range(90):
  (root/'heartbeat').write_text(str(i))
  time.sleep(1)
 (root/'unexpected-completion').write_text('finished')
