import assert from "node:assert/strict";
import test from "node:test";
import { ObsClient, obsAuthentication } from "../src/obs-client.js";

class FakeWebSocket {
  static instance;
  constructor() { this.listeners={}; this.sent=[]; FakeWebSocket.instance=this; }
  addEventListener(name, callback) { this.listeners[name]=callback; }
  send(value) { this.sent.push(JSON.parse(value)); }
  emit(message) { this.listeners.message({ data:JSON.stringify(message) }); }
  close() {}
}

const tick=()=>new Promise(resolve=>setImmediate(resolve));

test("computes the OBS WebSocket 5.x challenge response", () => {
  assert.equal(obsAuthentication("password","salt","challenge"),"zTM5ki6L2vVvBQiTG9ckH1Lh64AbnCf6XZ226UmnkIA=");
});

test("identifies, loads initial state, and follows external OBS events", async () => {
  const client=new ObsClient({url:"ws://127.0.0.1:4455",password:"password",WebSocketImpl:FakeWebSocket});
  client.connect(); const socket=FakeWebSocket.instance;
  socket.emit({op:0,d:{rpcVersion:1,authentication:{salt:"salt",challenge:"challenge"}}}); await tick();
  assert.equal(socket.sent[0].op,1); assert.equal(socket.sent[0].d.eventSubscriptions,69);
  socket.emit({op:2,d:{negotiatedRpcVersion:1}}); await tick();
  const requests=socket.sent.filter(message=>message.op===6);
  const sceneRequest=requests.find(message=>message.d.requestType==="GetCurrentProgramScene");
  const streamRequest=requests.find(message=>message.d.requestType==="GetStreamStatus");
  socket.emit({op:7,d:{requestId:sceneRequest.d.requestId,requestStatus:{result:true},responseData:{currentProgramSceneName:"Live"}}});
  socket.emit({op:7,d:{requestId:streamRequest.d.requestId,requestStatus:{result:true},responseData:{outputActive:true}}}); await tick();
  assert.deepEqual({scene:client.snapshot().scene,streaming:client.snapshot().streaming},{scene:"Live",streaming:true});
  socket.emit({op:5,d:{eventType:"CurrentProgramSceneChanged",eventData:{sceneName:"BRB"}}});
  socket.emit({op:5,d:{eventType:"StreamStateChanged",eventData:{outputActive:false}}}); await tick();
  assert.deepEqual({scene:client.snapshot().scene,streaming:client.snapshot().streaming},{scene:"BRB",streaming:false});
  const change=client.setScene("Low Bitrate"); await tick();
  const command=socket.sent.at(-1);
  assert.equal(command.d.requestType,"SetCurrentProgramScene");
  assert.deepEqual(command.d.requestData,{sceneName:"Low Bitrate"});
  socket.emit({op:7,d:{requestId:command.d.requestId,requestStatus:{result:true},responseData:{}}});
  await change;
  client.close();
});
