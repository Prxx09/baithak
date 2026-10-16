/** A shared, local-only meter. Audio samples never leave this browser. */
export class AudioActivity {
  private context: AudioContext;
  private inputs = new Map<string, { stream: MediaStream; source: MediaStreamAudioSourceNode; analyser: AnalyserNode; data: Uint8Array<ArrayBuffer>; lastLoud: number; speaking: boolean }>();
  private timer: ReturnType<typeof setInterval>;
  constructor(private changed: (id: string, speaking: boolean) => void) {
    this.context = new AudioContext();
    void this.context.resume().catch(() => {});
    this.timer = setInterval(() => this.sample(), 100);
  }
  attach(id: string, stream: MediaStream) {
    if (this.inputs.get(id)?.stream === stream) return;
    this.remove(id);
    if (!stream.getAudioTracks().length) return;
    const source = this.context.createMediaStreamSource(stream), analyser = this.context.createAnalyser();
    analyser.fftSize = 512; source.connect(analyser);
    // No destination connection: the meter never plays the local microphone.
    this.inputs.set(id, { stream, source, analyser, data: new Uint8Array(512), lastLoud: 0, speaking: false });
  }
  remove(id: string) {
    const input = this.inputs.get(id); if (!input) return;
    input.source.disconnect(); input.analyser.disconnect(); this.inputs.delete(id);
    if (input.speaking) this.changed(id, false);
  }
  private sample() {
    if (this.context.state !== 'running') return;
    for (const [id, input] of this.inputs) {
      input.analyser.getByteTimeDomainData(input.data);
      let sum = 0;
      for (const value of input.data) sum += ((value - 128) / 128) ** 2;
      const now = performance.now();
      if (Math.sqrt(sum / input.data.length) > 0.025) input.lastLoud = now;
      const speaking = input.lastLoud > 0 && now - input.lastLoud < 450;
      if (speaking !== input.speaking) { input.speaking = speaking; this.changed(id, speaking); }
    }
  }
  resume() { void this.context.resume().catch(() => {}); }
  close() { clearInterval(this.timer); for (const id of this.inputs.keys()) this.remove(id); void this.context.close().catch(() => {}); }
}
