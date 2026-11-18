let audioContext = null
let lastPlayed = 0

function context() {
  if (audioContext) return audioContext
  const Constructor = window.AudioContext || window.webkitAudioContext
  if (!Constructor) return null
  audioContext = new Constructor()
  return audioContext
}

export function unlockAudio() {
  const ctx = context()
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume()
}

export function playCompletionSound() {
  const ctx = context()
  if (!ctx) return
  const now = Date.now()
  if (now - lastPlayed < 400) return
  lastPlayed = now
  if (ctx.state === 'suspended') void ctx.resume()
  const start = ctx.currentTime
  const notes = [
    [523.25, 0],
    [659.25, 0.1],
    [783.99, 0.2],
    [1046.5, 0.32],
  ]
  notes.forEach(([frequency, delay]) => {
    const at = start + delay
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(0.09, at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.42)
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start(at)
    oscillator.stop(at + 0.46)
  })
}
