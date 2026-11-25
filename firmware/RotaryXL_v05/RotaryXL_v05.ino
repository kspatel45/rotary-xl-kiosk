/*
Date Created: 2026-10-01
Updated:      2026-11-25  (v05 - serial command firmware for the Signifi Rotary XL kiosk)

Author: Madison Laymon
Project: 0206 - Rotary XL - Firmware
Version: 05

What changed from v04 (NEMA34_TEST):
  - The column angles are NOT in the firmware any more. The kiosk (Admin > Calibration) stores
    the 12 column angles and sends "GOTO <degrees>". Re-calibrating never needs a re-flash.
  - Non-blocking main loop: the carousel can spin continuously and still take commands.
  - Crossing HOME during a move no longer stops the motor. Moving in the homing direction
    over the Hall sensor re-synchronises the position instead (corrects drift / lost steps).

Serial: 9600 baud, commands end with Newline (LF). One command per line, not case sensitive.
Every command ends with "Command Complete." (after the move has finished, for moves);
moves and position queries print "POS <commanded angle> <encoder angle>" right before it.

  HOME                 Search the Hall sensor and set 0 deg.          -> HOME COMPLETE | ERROR: HOME SENSOR NOT FOUND!
  GOTO <deg>           Move to an absolute angle 0-360, shortest way. -> Move Complete
  JOG <deg>            Move relative, e.g. JOG 0.5 / JOG -10.        -> Move Complete
  SPIN [rpm]           Turn continuously (default 2 rpm).            -> SPINNING (replies at once, keeps turning)
  STOPNEAR <a1> <a2>.. Decelerate and stop exactly on the first of the given angles that is ahead
                       in the turning direction (the kiosk sends the 12 column angles). -> Stopped
  STOP                 Decelerate and stop where it is.              -> Stopped
  POS?                 Report the position.
  SPEED <rpm>          Speed for GOTO / JOG (default 5 rpm).
  HELP                 List the commands.

While a GOTO/JOG/STOP is running only GOTO (new target), STOP and STOPNEAR are accepted;
anything else answers "ERROR: BUSY". GOTO during SPIN goes straight to the new target.
*/

// Libraries
#include <AccelStepper.h>

// Pins
#define HALL_Pin 18  // Hall Sensor (BLACK WIRE) - Mega external interrupt pin
#define ENC_A_Pin 3  // AM26C32 pin 3
#define ENC_B_Pin 2  // AM26C32 pin 5
#define PUL_Pin 24   // PUL+
#define DIR_Pin 25   // DIR+

/*
 Hall sensor:
 Brown -> Arduino 5V
 Blue  -> Arduino GND
 Black -> Arduino D18

 CL86T:
 D24  -> PUL+
 D25  -> DIR+
 GND -> PUL-
 GND -> DIR-
 ENA+ / ENA- -> leave disconnected
*/

// Motor
// CL86T SW1=ON, SW2=OFF, SW3=ON, SW4=ON selects 800 input pulses/revolution.   (comment from v04 - check it: the code below uses 1600)
const long motorStepsPerRev = 1600;
const long gearRatio = 4;                                // 4 motor revolutions = 1 carousel revolution
const long stepsPerRev = motorStepsPerRev * gearRatio;   // 6400 pulses per carousel revolution
const float stepsPerDeg = stepsPerRev / 360.0;           // 17.778 pulses per degree

// Encoder
const long motorEncoderCountsPerRev = 4000;
const long encoderCountsPerRev = motorEncoderCountsPerRev * gearRatio;   // 16000 counts per carousel revolution
const int encoderDirection = 1;

// Movement speed settings
float moveRPM = 5.0;               // GOTO / JOG (SPEED command changes it)
const float homeRPM = 3.0;
const float defaultSpinRPM = 2.0;  // SPIN without a number
const float rampTimeSeconds = 3.0; // time to reach full speed (acceleration)

// Homing settings
const int homeDirection = 1;                     // +1 or -1: direction that searches for HOME
const long maxHomeSearchSteps = stepsPerRev * 2;
const float hallSyncMaxDeg = 10.0;               // re-sync only if the error is small (else just warn)

// Stepper Object
AccelStepper stepper(AccelStepper::DRIVER, PUL_Pin, DIR_Pin);

// ------------------------------------------------------------------ state
enum Mode { M_IDLE, M_MOVING, M_SPINNING, M_STOPPING };
Mode mode = M_IDLE;
bool isHomed = false;

volatile long encoderCount = 0;     // updated only by the encoder interrupts
volatile bool hallEdge = false;     // set by the Hall interrupt, handled in loop()

long offsetSteps = 0;      // logical position = stepper position - offsetSteps (changed by Hall re-sync)
long targetLogical = 0;    // target of the running GOTO / JOG / STOPNEAR
int spinDir = 1;
float currentAccel = 1;    // acceleration of the active profile (steps/s^2)

// ------------------------------------------------------------------ interrupts
void encoderA_ISR() {
  bool a = digitalRead(ENC_A_Pin), b = digitalRead(ENC_B_Pin);
  encoderCount += (a == b) ? 1 : -1;
}
void encoderB_ISR() {
  bool a = digitalRead(ENC_A_Pin), b = digitalRead(ENC_B_Pin);
  encoderCount += (a != b) ? 1 : -1;
}
void hallISR() { hallEdge = true; }   // AccelStepper is not interrupt-safe: loop() does the work

// ------------------------------------------------------------------ helpers
long readEncoderCount() { noInterrupts(); long c = encoderCount; interrupts(); return c; }
void zeroEncoderCount() { noInterrupts(); encoderCount = 0; interrupts(); }

bool hallTriggered() { return digitalRead(HALL_Pin) == LOW; }   // NJK-5002C NPN NO: LOW = at HOME

float normDeg(float a) { while (a >= 360.0) a -= 360.0; while (a < 0.0) a += 360.0; return a; }
long modSteps(long a) { long r = a % stepsPerRev; return r < 0 ? r + stepsPerRev : r; }
long logicalPos() { return stepper.currentPosition() - offsetSteps; }
float commandedAngle() { return normDeg((float)logicalPos() / stepsPerDeg); }
float encoderAngle() { return normDeg(((float)(readEncoderCount() * encoderDirection) / encoderCountsPerRev) * 360.0); }

void setProfile(float rpm) {
  float sp = (stepsPerRev * rpm) / 60.0;
  currentAccel = sp / rampTimeSeconds;
  stepper.setMaxSpeed(sp);
  stepper.setAcceleration(currentAccel);
}

void printPos() {
  Serial.print("POS ");
  Serial.print(commandedAngle(), 2);
  Serial.print(' ');
  Serial.println(encoderAngle(), 2);
}
void complete() { printPos(); Serial.println("Command Complete."); }
void fail(const char *msg) { Serial.print("ERROR: "); Serial.println(msg); Serial.println("Command Complete."); }

// logical target for an absolute angle, the shortest way from where we are
long shortestTarget(float deg) {
  long p = logicalPos();
  long d = lround(normDeg(deg) * stepsPerDeg) - modSteps(p);
  if (d > stepsPerRev / 2) d -= stepsPerRev;
  if (d < -stepsPerRev / 2) d += stepsPerRev;
  return p + d;
}

void startMove(long logicalTarget, float rpm) {
  targetLogical = logicalTarget;
  setProfile(rpm);
  stepper.moveTo(targetLogical + offsetSteps);
  mode = M_MOVING;
}

// ------------------------------------------------------------------ homing (blocking, as in v04)
bool homeMotor() {
  Serial.println("HOMING");
  hallEdge = false;

  if (hallTriggered()) {
    Serial.println("Motor is already at HOME.");
  } else {
    Serial.println("Searching for HOME...");
    setProfile(homeRPM);
    long start = stepper.currentPosition();
    stepper.moveTo(start + (long)homeDirection * maxHomeSearchSteps);
    bool found = false;
    while (stepper.distanceToGo() != 0) {
      if ((hallEdge || hallTriggered()) && hallTriggered()) { found = true; break; }   // confirmed LOW, not noise
      hallEdge = false;
      stepper.run();
    }
    if (!found) {
      stepper.setCurrentPosition(stepper.currentPosition());   // cancel the search
      isHomed = false;
      Serial.println("ERROR: HOME SENSOR NOT FOUND!");
      Serial.print("Actual revolutions: ");
      Serial.println((float)labs(readEncoderCount()) / encoderCountsPerRev, 3);
      setProfile(moveRPM);
      return false;
    }
    Serial.println("Hall sensor detected.");
  }

  stepper.setCurrentPosition(0);   // HOME = 0 degrees (also cancels any motion)
  offsetSteps = 0;
  zeroEncoderCount();
  isHomed = true;
  hallEdge = false;
  mode = M_IDLE;
  setProfile(moveRPM);
  Serial.println("HOME COMPLETE");
  return true;
}

// ------------------------------------------------------------------ commands
void cmdStopNear(char *args) {
  // collect the candidate angles
  float angles[16];
  int n = 0;
  for (char *t = strtok(args, " ,"); t && n < 16; t = strtok(NULL, " ,")) angles[n++] = atof(t);
  if (n == 0) { fail("STOPNEAR needs at least one angle"); return; }

  long p = logicalPos();
  float v = stepper.speed();                      // steps/s, signed
  if (mode == M_IDLE || fabs(v) < 1.0) {            // standing still: nearest angle, shortest way
    long best = 0, bestDist = 0x7FFFFFFF;
    for (int i = 0; i < n; i++) { long t = shortestTarget(angles[i]); if (labs(t - p) < bestDist) { bestDist = labs(t - p); best = t; } }
    startMove(best, moveRPM);
    return;
  }
  int dir = v > 0 ? 1 : -1;
  long stopSteps = (long)((v * v) / (2.0 * currentAccel)) + 1;   // distance needed to decelerate
  long best = 0, bestDist = 0x7FFFFFFF;
  long base = p - modSteps(p);
  for (int i = 0; i < n; i++) {
    long a = lround(normDeg(angles[i]) * stepsPerDeg);
    for (int k = -1; k <= 2; k++) {
      long cand = base + a + (long)k * stepsPerRev;
      long dist = (cand - p) * dir;
      if (dist >= stopSteps && dist < bestDist) { bestDist = dist; best = cand; }
    }
  }
  targetLogical = best;                            // keep the spin speed, just give it an end point
  stepper.moveTo(targetLogical + offsetSteps);
  mode = M_MOVING;
}

void handleCommand(char *line) {
  // trim + upper case
  while (*line == ' ' || *line == '\t') line++;
  for (char *c = line; *c; c++) *c = toupper(*c);
  int len = strlen(line);
  while (len && (line[len - 1] == ' ' || line[len - 1] == '\t')) line[--len] = 0;
  if (!len) return;

  char *args = strchr(line, ' ');
  if (args) { *args = 0; args++; while (*args == ' ') args++; } else args = line + len;
  bool busy = (mode == M_MOVING || mode == M_STOPPING);

  if (!strcmp(line, "HOME")) {
    if (busy || mode == M_SPINNING) { stepper.stop(); while (stepper.distanceToGo() != 0) stepper.run(); }
    if (homeMotor()) complete(); else Serial.println("Command Complete.");
  }
  else if (!strcmp(line, "GOTO")) {
    if (!isHomed) { fail("NOT HOMED"); return; }
    if (!*args) { fail("GOTO needs an angle"); return; }
    startMove(shortestTarget(atof(args)), moveRPM);
  }
  else if (!strcmp(line, "JOG")) {
    if (!isHomed) { fail("NOT HOMED"); return; }
    if (busy || mode == M_SPINNING) { fail("BUSY"); return; }
    if (!*args) { fail("JOG needs degrees, e.g. JOG 0.5"); return; }
    startMove(logicalPos() + lround(atof(args) * stepsPerDeg), moveRPM);
  }
  else if (!strcmp(line, "SPIN")) {
    if (!isHomed) { fail("NOT HOMED"); return; }
    if (busy) { fail("BUSY"); return; }
    float rpm = *args ? atof(args) : defaultSpinRPM;
    if (rpm < 0) { spinDir = -1; rpm = -rpm; } else spinDir = 1;
    if (rpm < 0.1) rpm = defaultSpinRPM;
    setProfile(rpm);
    stepper.moveTo(stepper.currentPosition() + (long)spinDir * stepsPerRev * 20);
    mode = M_SPINNING;
    Serial.println("SPINNING");
    complete();
  }
  else if (!strcmp(line, "STOPNEAR")) {
    if (!isHomed) { fail("NOT HOMED"); return; }
    cmdStopNear(args);
  }
  else if (!strcmp(line, "STOP")) {
    if (mode == M_IDLE) { Serial.println("Stopped"); complete(); return; }
    stepper.stop();      // decelerate with the current ramp
    mode = M_STOPPING;
  }
  else if (!strcmp(line, "POS?") || !strcmp(line, "POS")) {
    complete();
  }
  else if (!strcmp(line, "SPEED")) {
    float rpm = atof(args);
    if (rpm < 0.1 || rpm > 30) { fail("SPEED must be 0.1 - 30 rpm"); return; }
    moveRPM = rpm;
    Serial.print("SPEED ");
    Serial.println(moveRPM, 2);
    Serial.println("Command Complete.");
  }
  else if (!strcmp(line, "HELP")) {
    Serial.println("HOME | GOTO <deg> | JOG <deg> | SPIN [rpm] | STOPNEAR <a1> <a2>... | STOP | POS? | SPEED <rpm>");
    Serial.println("Command Complete.");
  }
  else {
    Serial.print("Invalid Command: ");
    Serial.println(line);
    Serial.println("Command Complete.");
  }
}

// ------------------------------------------------------------------ setup / loop
void setup() {
  Serial.begin(9600);

  pinMode(HALL_Pin, INPUT_PULLUP);
  pinMode(ENC_A_Pin, INPUT);   // AM26C32 drives these, no pull-ups
  pinMode(ENC_B_Pin, INPUT);

  attachInterrupt(digitalPinToInterrupt(HALL_Pin), hallISR, FALLING);   // HIGH -> LOW at HOME
  attachInterrupt(digitalPinToInterrupt(ENC_A_Pin), encoderA_ISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENC_B_Pin), encoderB_ISR, CHANGE);

  stepper.setPinsInverted(true, false, false);   // reverse motor direction while keeping angles positive
  stepper.setMinPulseWidth(5);
  setProfile(moveRPM);

  Serial.println();
  Serial.println("System Starting - Rotary XL firmware v05");

  if (homeMotor()) {
    Serial.println("System Ready.");
  } else {
    Serial.println("System NOT ready.");
    Serial.println("HOME SENSOR ERROR.");
  }
}

char rxBuf[160];
int rxLen = 0;

void loop() {
  stepper.run();

  // read commands without blocking the motor
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (rxLen) { rxBuf[rxLen] = 0; rxLen = 0; handleCommand(rxBuf); }
    } else if (rxLen < (int)sizeof(rxBuf) - 1) {
      rxBuf[rxLen++] = c;
    }
    stepper.run();
  }

  // keep spinning: push the far-away target further out
  if (mode == M_SPINNING && labs(stepper.distanceToGo()) < stepsPerRev * 10) {
    stepper.moveTo(stepper.currentPosition() + (long)spinDir * stepsPerRev * 20);
  }

  // Hall sensor passed while turning in the homing direction: re-synchronise (no stop)
  if (hallEdge) {
    hallEdge = false;
    if (isHomed && mode != M_IDLE && hallTriggered() && stepper.speed() * homeDirection > 0) {
      long p = logicalPos();
      long k = lround((double)p / stepsPerRev);
      long err = p - k * stepsPerRev;
      float errDeg = err / stepsPerDeg;
      if (fabs(errDeg) <= hallSyncMaxDeg) {
        offsetSteps += err;
        if (mode == M_MOVING) stepper.moveTo(targetLogical + offsetSteps);
        if (fabs(errDeg) >= 0.2) { Serial.print("HALL SYNC "); Serial.println(errDeg, 2); }
      } else {
        Serial.print("HALL WARN ");
        Serial.println(errDeg, 2);
      }
    }
  }

  // move finished
  if ((mode == M_MOVING || mode == M_STOPPING) && stepper.distanceToGo() == 0) {
    Serial.println(mode == M_MOVING ? "Move Complete" : "Stopped");
    mode = M_IDLE;
    setProfile(moveRPM);
    complete();
  }
}
