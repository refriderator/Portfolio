"""
Generate a CSS linear() easing that samples a damped harmonic oscillator.

Model: x'' + 2*zeta*w*x' + w^2 (x - 1) = 0,  x(0) = 0, x'(0) = 0
Underdamped step response (0 < zeta < 1):
    x(t) = 1 - e^(-zeta*w*t) * ( cos(wd*t) + (zeta*w/wd) * sin(wd*t) ),  wd = w*sqrt(1 - zeta^2)

Time is normalised to t in [0, 1] (CSS maps this onto the transition duration).
We choose w so the envelope e^(-zeta*w*t) has decayed to `tolerance` at t = 1,
i.e. the motion has visually settled by the end of the transition.

Usage: python3 spring.py [zeta] [samples] [hold]
  hold  "hold" makes a staircase instead of a smooth curve: each of the
        `samples` values is held until the next one (a zero-order hold, as
        a DAC or an old game running at a fixed frame rate does). For a
        900ms transition at 12 frames per second, use samples = 11.
"""
import math, sys

zeta = float(sys.argv[1]) if len(sys.argv) > 1 else 0.55
samples = int(sys.argv[2]) if len(sys.argv) > 2 else 40
hold = len(sys.argv) > 3 and sys.argv[3] == "hold"
tolerance = 1e-3

w = math.log(1 / tolerance) / zeta          # natural frequency (per unit duration)
wd = w * math.sqrt(1 - zeta ** 2)           # damped frequency

def x(t):
    return 1 - math.exp(-zeta * w * t) * (math.cos(wd * t) + (zeta * w / wd) * math.sin(wd * t))

points = [x(i / samples) for i in range(samples + 1)]
points[-1] = 1.0                            # land exactly on the target
overshoot = math.exp(-math.pi * zeta / math.sqrt(1 - zeta ** 2))

fmt = lambda v: f"{v:.4f}".rstrip("0").rstrip(".") or "0"
pct = lambda i: fmt(100 * i / samples) + "%"

if hold:
    # Value i holds from i/samples to (i+1)/samples; two stops at the same
    # position make linear() jump instead of ramp.
    stops = [f"{fmt(points[0])} 0%"]
    for i in range(1, samples + 1):
        stops += [f"{fmt(points[i - 1])} {pct(i)}", f"{fmt(points[i])} {pct(i)}"]
    print(f"/* zeta = {zeta}, overshoot = {overshoot:.1%}, held for {samples} frames */")
    print("linear(" + ", ".join(stops) + ")")
else:
    print(f"/* zeta = {zeta}, overshoot = {overshoot:.1%}, {samples} samples */")
    print("linear(" + ", ".join(fmt(p) for p in points) + ")")
