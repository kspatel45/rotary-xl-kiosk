/*
Date Created: 2026-10-01
Updated:      2026-11-25  (v06 - one-direction motion, separate ramp up / ramp down, set from the kiosk)

Author: Madison Laymon
Project: 0206 - Rotary XL - Firmware
Version: 06

What changed from v05:
  - The carousel only turns ONE way (clockwise). GOTO and STOPNEAR always go forward, even if
    that is the long way round. Only JOG with a negative number turns back (calibration only).
  - Own motion controller with SEPARATE ramp-up and ramp-down times (AccelStepper alone has one
    acceleration for both). Move speed, free-run (spin) speed and both ramps are sent by the kiosk
    (Admin > Calibration > Motion) after every homing, so they never need a re-flash.
  - All angles are clockwise degrees from HOME. DIR tells the firmware which motor direction is
    clockwise for this machine.

Serial: 9600 baud, commands end with Newline (LF). One command per line, not case sensitive.
Every command ends with "Command Complete." (after the move has finished, for moves);
moves and position queries print "POS <angle> <encoder angle>" right before it.

  HOME                 Search the Hall sensor (turning clockwise) and set 0 deg.
  GOTO <deg>           Turn clockwise to an angle 0-360.                 -> Move Complete
  JOG <deg>            Relative: + = clockwise, - = counter-clockwise.   -> Move Complete
  SPIN [rpm]           Free run clockwise (rpm = free-run speed).        -> SPINNING (replies at once)
  STOPNEAR <a1> <a2>.. Ramp down and stop exactly on the first of the angles ahead. -> Move Complete
  STOP                 Ramp down and stop where it is.                    -> Stopped
  SPEED <rpm>          Move speed for GOTO / JOG.
  RUNSPEED <rpm>       Free-run speed for SPIN.
  RAMP <up s> <down s> Ramp-up time (0 -> speed) and ramp-down time (speed -> 0) in seconds.
  DIR <1|-1>           Motor direction that turns the carousel clockwise (only while stopped).
  POS?                 Report the position.
  CONFIG?              Report the motion settings.
  HELP                 List the commands.
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

// Motion settings (defaults; the kiosk sends its own values after homing)
float moveRPM = 5.0;        // GOTO / JOG            (SPEED)
float runRPM = 2.0;         // SPIN free run         (RUNSPEED / SPIN <rpm>)
float rampUpSec = 3.0;      // 0 -> speed            (RAMP)
float rampDownSec = 3.0;    // speed -> 0            (RAMP)
int cwDir = 1;              // motor direction that is clockwise (DIR); +1 keeps the v04 direction
const float homeRPM = 3.0;
const float minStepRate = 30.0;   // steps/s floor near the target, so every move finishes

// Homing settings
const long maxHomeSearchSteps = stepsPerRev * 2;
const float hallSyncMaxDeg = 10.0;   // re-sync only if the error is small (else just warn)

// Stepper Object
AccelStepper stepper(AccelStepper::DRIVER, PUL_Pin, DIR_Pin);

// ------------------------------------------------------------------ state
enum Mode { M_IDLE, M_MOVING, M_SPINNING, M_STOPPING };
Mode mode = M_IDLE;
bool isHomed = false;

volatile long encoderCount = 0;     // updated only by the encoder interrupts
volatile bool hallEdge = false;     // set by the Hall interrupt, handled in loop()

long offsetSteps = 0;     // logical position = stepper position - offsetSteps (changed by Hall re-sync)
long targetCW = 0;        // target of the running move, in clockwise steps from HOME
int moveSense = 1;        // +1 = clockwise, -1 = counter-clockwise (reverse JOG only)
float vCur = 0;           // current speed, steps/s (always >= 0)
float vMax = 0;           // cruise speed of the running move
float accUp = 1, accDown = 1;   // steps/s^2
unsigned long lastUpdate = 0;

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
float atLeast(float a, float b) { return a > b ? a : b; }
float rpmToRate(float rpm) { return (stepsPerRev * rpm) / 60.0; }

long cwPos() { return (long)cwDir * (stepper.currentPosition() - offsetSteps); }   // clockwise steps from HOME
float cwAngle() { return normDeg((float)cwPos() / stepsPerDeg); }
float encoderAngle() { return normDeg((float)cwDir * encoderDirection * readEncoderCount() / encoderCountsPerRev * 360.0); }

void printPos() {
  Serial.print("POS ");
  Serial.print(cwAngle(), 2);
  Serial.print(' ');
  Serial.println(encoderAngle(), 2);
}
void complete() { printPos(); Serial.println("Command Complete."); }
void fail(const char *msg) { Serial.print("ERROR: "); Serial.println(msg); Serial.println("Command Complete."); }

// distance needed to ramp down from the current speed
long stoppingSteps() { return (long)((vCur * vCur) / (2.0 * accDown)) + 1; }

// start / re-target a move; keeps the current speed (smooth when re-targeting a running move)
void startMove(long target, int sense, float rpm) {
  if (sense != moveSense) vCur = 0;   // a change of direction always starts from standstill
  targetCW = target;
  moveSense = sense;
  vMax = rpmToRate(rpm);
  accUp = vMax / atLeast(rampUpSec, 0.05);
  accDown = vMax / atLeast(rampDownSec, 0.05);
  if (mode == M_IDLE) lastUpdate = micros();
  mode = M_MOVING;
}

// clockwise target for an angle: always forward; while moving it must also be reachable with the ramp-down
long forwardTarget(float deg) {
  long p = cwPos();
  long d = modSteps(lround(normDeg(deg) * stepsPerDeg) - modSteps(p));
  if (mode != M_IDLE && moveSense == 1) { while (d < stoppingSteps()) d += stepsPerRev; }
  return p + d;
}

// ------------------------------------------------------------------ motion controller (trapezoid, separate ramps)
void finishMove() {
  bool wasStop = (mode == M_STOPPING);
  vCur = 0;
  stepper.setSpeed(0);
  mode = M_IDLE;
  Serial.println(wasStop ? "Stopped" : "Move Complete");
  complete();
}

void motionUpdate() {
  if (mode == M_IDLE) return;
  unsigned long now = micros();
  float dt = (now - lastUpdate) * 1e-6;
  if (dt >= 0.002) {                 // re-plan the speed every 2 ms
    lastUpdate = now;
    if (dt > 0.05) dt = 0.05;
    float vWant = vMax;
    if (mode != M_SPINNING) {
      long rem = (targetCW - cwPos()) * moveSense;
      if (rem <= 0) { finishMove(); return; }
      float vStop = sqrt(2.0 * accDown * rem);   // fastest speed that can still stop on the target
      if (vStop < vWant) vWant = vStop;
      if (vWant < minStepRate) vWant = minStepRate;
    }
    if (vCur < vWant) { vCur += accUp * dt; if (vCur > vWant) vCur = vWant; }
    else { vCur -= accDown * dt; if (vCur < vWant) vCur = vWant; }
    stepper.setSpeed((float)cwDir * moveSense * vCur);
  }
  stepper.runSpeed();
  if (mode != M_SPINNING && (targetCW - cwPos()) * moveSense <= 0) finishMove();
}

// ------------------------------------------------------------------ homing (blocking, clockwise)
bool homeMotor() {
  Serial.println("HOMING");
  mode = M_IDLE; vCur = 0;
  hallEdge = false;

  if (hallTriggered()) {
    Serial.println("Motor is already at HOME.");
  } else {
    Serial.println("Searching for HOME...");
    float sp = rpmToRate(homeRPM);
    stepper.setMaxSpeed(sp);
    stepper.setAcceleration(sp / atLeast(rampUpSec, 0.05));
    stepper.moveTo(stepper.currentPosition() + (long)cwDir * maxHomeSearchSteps);
    bool found = false;
    while (stepper.distanceToGo() != 0) {
      if (hallTriggered()) { found = true; break; }   // confirmed LOW, not a noise edge
      stepper.run();
    }
    if (!found) {
      stepper.setCurrentPosition(stepper.currentPosition());   // cancel the search
      isHomed = false;
      Serial.println("ERROR: HOME SENSOR NOT FOUND!");
      Serial.print("Actual revolutions: ");
      Serial.println((float)labs(readEncoderCount()) / encoderCountsPerRev, 3);
      stepper.setMaxSpeed(rpmToRate(30));
      return false;
    }
    Serial.println("Hall sensor detected.");
  }

  stepper.setCurrentPosition(0);   // HOME = 0 degrees (also cancels any motion)
  stepper.setMaxSpeed(rpmToRate(30));   // upper limit for runSpeed(); the motion controller sets the real speed
  stepper.setSpeed(0);
  offsetSteps = 0;
  zeroEncoderCount();
  isHomed = true;
  hallEdge = false;
  Serial.println("HOME COMPLETE");
  return true;
}

// ------------------------------------------------------------------ commands
void printConfig() {
  Serial.print("CONFIG SPEED "); Serial.print(moveRPM, 2);
  Serial.print(" RUNSPEED "); Serial.print(runRPM, 2);
  Serial.print(" RAMP "); Serial.print(rampUpSec, 2); Serial.print(' '); Serial.print(rampDownSec, 2);
  Serial.print(" DIR "); Serial.println(cwDir);
}

void cmdStopNear(char *args) {
  float angles[16];
  int n = 0;
  for (char *t = strtok(args, " ,"); t && n < 16; t = strtok(NULL, " ,")) angles[n++] = atof(t);
  if (n == 0) { fail("STOPNEAR needs at least one angle"); return; }

  long p = cwPos();
  long need = (mode == M_IDLE || moveSense != 1) ? 0 : stoppingSteps();
  long best = 0, bestDist = 0x7FFFFFFF;
  for (int i = 0; i < n; i++) {
    long d = modSteps(lround(normDeg(angles[i]) * stepsPerDeg) - modSteps(p));
    while (d < need) d += stepsPerRev;
    if (d < bestDist) { bestDist = d; best = p + d; }
  }
  if (bestDist == 0 && mode == M_IDLE) { Serial.println("Move Complete"); complete(); return; }
  float rpm = (mode == M_SPINNING) ? runRPM : moveRPM;   // keep the running speed, just add an end point
  startMove(best, 1, rpm);
}

bool readFloat(char *s, float lo, float hi, float &out) {
  if (!*s) return false;
  out = atof(s);
  return out >= lo && out <= hi;
}

void handleCommand(char *line) {
  while (*line == ' ' || *line == '\t') line++;
  for (char *c = line; *c; c++) *c = toupper(*c);
  int len = strlen(line);
  while (len && (line[len - 1] == ' ' || line[len - 1] == '\t')) line[--len] = 0;
  if (!len) return;

  char *args = strchr(line, ' ');
  if (args) { *args = 0; args++; while (*args == ' ') args++; } else args = line + len;
  bool busy = (mode == M_MOVING || mode == M_STOPPING);
  float v;

  if (!strcmp(line, "HOME")) {
    if (homeMotor()) complete(); else Serial.println("Command Complete.");
  }
  else if (!strcmp(line, "GOTO")) {
    if (!isHomed) { fail("NOT HOMED"); return; }
    if (!*args) { fail("GOTO needs an angle"); return; }
    if (busy && moveSense != 1) { fail("BUSY"); return; }   // finish a reverse JOG first
    long t = forwardTarget(atof(args));
    if (t == cwPos() && mode == M_IDLE) { Serial.println("Move Complete"); complete(); return; }
    startMove(t, 1, moveRPM);
  }
  else if (!strcmp(line, "JOG")) {
    if (!isHomed) { fail("NOT HOMED"); return; }
    if (mode != M_IDLE) { fail("BUSY"); return; }
    if (!*args) { fail("JOG needs degrees, e.g. JOG 0.5"); return; }
    float deg = atof(args);
    long steps = lround(fabs(deg) * stepsPerDeg);
    if (steps == 0) { Serial.println("Move Complete"); complete(); return; }
    int sense = deg < 0 ? -1 : 1;
    startMove(cwPos() + sense * steps, sense, moveRPM);
  }
  else if (!strcmp(line, "SPIN")) {
    if (!isHomed) { fail("NOT HOMED"); return; }
    if (busy && moveSense != 1) { fail("BUSY"); return; }
    if (*args) { if (!readFloat(args, 0.1, 30, v)) { fail("SPIN rpm must be 0.1 - 30"); return; } runRPM = v; }
    if (mode == M_IDLE) { lastUpdate = micros(); vCur = 0; }
    moveSense = 1;
    vMax = rpmToRate(runRPM);
    accUp = vMax / atLeast(rampUpSec, 0.05);
    accDown = vMax / atLeast(rampDownSec, 0.05);
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
    targetCW = cwPos() + moveSense * stoppingSteps();
    mode = M_STOPPING;
  }
  else if (!strcmp(line, "SPEED")) {
    if (!readFloat(args, 0.1, 30, v)) { fail("SPEED must be 0.1 - 30 rpm"); return; }
    moveRPM = v; printConfig(); Serial.println("Command Complete.");
  }
  else if (!strcmp(line, "RUNSPEED")) {
    if (!readFloat(args, 0.1, 30, v)) { fail("RUNSPEED must be 0.1 - 30 rpm"); return; }
    runRPM = v;
    if (mode == M_SPINNING) { vMax = rpmToRate(runRPM); accUp = vMax / atLeast(rampUpSec, 0.05); accDown = vMax / atLeast(rampDownSec, 0.05); }
    printConfig(); Serial.println("Command Complete.");
  }
  else if (!strcmp(line, "RAMP")) {
    char *b = strchr(args, ' ');
    if (b) { *b = 0; b++; while (*b == ' ') b++; }
    float up, down;
    if (!readFloat(args, 0.05, 30, up) || !b || !readFloat(b, 0.05, 30, down)) { fail("RAMP <up s> <down s>, each 0.05 - 30"); return; }
    rampUpSec = up; rampDownSec = down;
    if (mode != M_IDLE) { accUp = vMax / rampUpSec; accDown = vMax / rampDownSec; }
    printConfig(); Serial.println("Command Complete.");
  }
  else if (!strcmp(line, "DIR")) {
    if (mode != M_IDLE) { fail("BUSY"); return; }
    int d = atoi(args);
    if (d != 1 && d != -1) { fail("DIR must be 1 or -1"); return; }
    cwDir = d;   // same physical spot; angles are now counted the other way (re-calibrate the columns)
    printConfig(); complete();
  }
  else if (!strcmp(line, "POS?") || !strcmp(line, "POS")) {
    complete();
  }
  else if (!strcmp(line, "CONFIG?") || !strcmp(line, "CONFIG")) {
    printConfig(); Serial.println("Command Complete.");
  }
  else if (!strcmp(line, "HELP")) {
    Serial.println("HOME | GOTO <deg> | JOG <+-deg> | SPIN [rpm] | STOPNEAR <a1> <a2>... | STOP");
    Serial.println("SPEED <rpm> | RUNSPEED <rpm> | RAMP <up s> <down s> | DIR <1|-1> | POS? | CONFIG?");
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

  stepper.setPinsInverted(true, false, false);   // as in v04
  stepper.setMinPulseWidth(5);
  stepper.setMaxSpeed(rpmToRate(30));            // upper limit for runSpeed(); the controller sets the real speed

  Serial.println();
  Serial.println("System Starting - Rotary XL firmware v06");

  if (homeMotor()) {
    Serial.println("System Ready.");
  } else {
    Serial.println("System NOT ready.");
    Serial.println("HOME SENSOR ERROR.");
  }
  stepper.setMaxSpeed(rpmToRate(30));
}

char rxBuf[160];
int rxLen = 0;

void loop() {
  motionUpdate();

  // read commands without blocking the motor
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (rxLen) { rxBuf[rxLen] = 0; rxLen = 0; handleCommand(rxBuf); }
    } else if (rxLen < (int)sizeof(rxBuf) - 1) {
      rxBuf[rxLen++] = c;
    }
    motionUpdate();
  }

  // Hall sensor passed while turning clockwise: re-synchronise the position (no stop)
  if (hallEdge) {
    hallEdge = false;
    if (isHomed && mode != M_IDLE && moveSense == 1 && hallTriggered()) {
      long p = cwPos();
      long k = lround((double)p / stepsPerRev);
      long err = p - k * stepsPerRev;
      float errDeg = err / stepsPerDeg;
      if (fabs(errDeg) <= hallSyncMaxDeg) {
        offsetSteps += (long)cwDir * err;   // cwPos() drops by err; targets are clockwise steps, so they follow
        if (fabs(errDeg) >= 0.2) { Serial.print("HALL SYNC "); Serial.println(errDeg, 2); }
      } else {
        Serial.print("HALL WARN ");
        Serial.println(errDeg, 2);
      }
    }
  }
}
