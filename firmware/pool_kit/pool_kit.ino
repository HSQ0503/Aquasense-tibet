//This code is for the Atlas Scientific wifi pool kit that uses the Adafruit ESP32-S3 TFT Feather as its computer.

#include <iot_cmd.h>
#include <math.h>
#include "secrets.h"
#include <WiFi.h>                                                //include wifi library
#include "ThingSpeak.h"                                          //include thingspeak library
#include <sequencer4.h>                                          //imports a 4 function sequencer
#include <sequencer1.h>                                          //imports a 1 function sequencer
#include <Ezo_i2c_util.h>                                        //brings in common print statements
#include <Ezo_i2c.h> //include the EZO I2C library from https://github.com/Atlas-Scientific/Ezo_I2c_lib
#include <Wire.h>    //include arduinos i2c library

#include <Adafruit_GFX.h>    // Core graphics library
#include <Adafruit_ST7789.h> // Hardware-specific library for ST7789
#include <SPI.h>

#include <Fonts/FreeSansBold12pt7b.h>
#include <Fonts/FreeSansBold18pt7b.h>

WiFiClient client;                                              //declare that this device connects to a Wi-Fi network,create a connection to a specified internet IP address

// Use dedicated hardware SPI pins
Adafruit_ST7789 tft = Adafruit_ST7789(TFT_CS, TFT_DC, TFT_RST);
GFXcanvas16 canvas(240, 135);

const String ssid = WIFI_SSID;
const String pass = WIFI_PASSWORD;
const unsigned long myChannelNumber = 3536852;
const char *myWriteAPIKey = THINGSPEAK_WRITE_API_KEY;

float ph_reading = NAN;
float orp_reading = NAN;
float temperature = NAN;
float pending_temperature = NAN;
bool readings_ready = false;
unsigned long last_reading_at = 0;

Ezo_board PH = Ezo_board(99, "PH");           //create a PH circuit object, who's address is 99 and name is "PH"
Ezo_board ORP = Ezo_board(98, "ORP");         //create an ORP circuit object who's address is 98 and name is "ORP"
Ezo_board RTD = Ezo_board(102, "RTD");        //create an RTD circuit object who's address is 102 and name is "RTD"

Ezo_board device_list[] = {   //an array of boards used for sending commands to all or specific boards
  PH,
  ORP,
  RTD
};

Ezo_board* default_board = &device_list[0]; //used to store the board were talking to

//gets the length of the array automatically so we dont have to change the number every time we add new boards
const uint8_t device_list_len = sizeof(device_list) / sizeof(device_list[0]);

//enable pins for each circuit
const int EN_PH = 12;
const int EN_ORP = 11;
const int EN_RTD = 9;
const int EN_AUX = 10;

const unsigned long reading_delay = 1000;                 //how long we wait to receive a response, in milliseconds
const unsigned long thingspeak_delay = 16000;             //how long we wait to send values to thingspeak, in milliseconds

// The sensor sequence needs 2300 ms before the pause between cycles.
const unsigned long poll_delay = 700;

bool polling  = true;                                     //variable to determine whether or not were polling the circuits
bool send_to_thingspeak = true;                           //variable to determine whether or not were sending data to thingspeak

bool wifi_isconnected() {                           //function to check if wifi is connected
  return (WiFi.status() == WL_CONNECTED);
}

void reconnect_wifi() {                                   //function to reconnect wifi if its not connected
  if (!wifi_isconnected()) {
    WiFi.begin(ssid.c_str(), pass.c_str());
    Serial.println("connecting to wifi");
  }
}

void thingspeak_send() {
  if (!send_to_thingspeak || !wifi_isconnected() || !readings_ready ||
      millis() - last_reading_at > 10000) return;

  ThingSpeak.setField(1, isfinite(ph_reading) ? String(ph_reading, 2) : String(""));
  ThingSpeak.setField(2, isfinite(orp_reading) ? String(orp_reading, 0) : String(""));
  ThingSpeak.setField(3, isfinite(temperature) ? String(temperature, 2) : String(""));
  ThingSpeak.setStatus(isfinite(temperature) ? "AquaSense physical sensors" :
                       "RTD missing; pH compensation assumes 25 C");
  int return_code = ThingSpeak.writeFields(myChannelNumber, myWriteAPIKey);
  Serial.print("ThingSpeak result: ");
  Serial.println(return_code);
}

void step1();      //forward declarations of functions to use them in the sequencer before defining them
void step2();
void step3();
void step4();
Sequencer4 Seq(&step1, reading_delay,   //calls the steps in sequence with time in between them
               &step2, 300,
               &step3, reading_delay,
               &step4, poll_delay);

Sequencer1 Wifi_Seq(&reconnect_wifi, 10000);  //calls the wifi reconnect function every 10 seconds

Sequencer1 Thingspeak_seq(&thingspeak_send, thingspeak_delay); //sends data to thingspeak with the time determined by thingspeak delay

void setup() {

  pinMode(EN_PH, OUTPUT);                                                         //set enable pins as outputs
  pinMode(EN_ORP, OUTPUT);
  pinMode(EN_RTD, OUTPUT);
  pinMode(EN_AUX, OUTPUT);
  digitalWrite(EN_PH, LOW);                                                       //set enable pins to enable the circuits
  digitalWrite(EN_ORP, LOW);
  digitalWrite(EN_RTD, HIGH);
  digitalWrite(EN_AUX, HIGH); // Keep the unused auxiliary circuit disabled.

  Wire.begin();                           //start the I2C
  Serial.begin(9600);                     //start the serial communication to the computer

  pinMode(TFT_BACKLITE, OUTPUT);
  digitalWrite(TFT_BACKLITE, HIGH);

  // turn on the TFT / I2C power supply
  pinMode(TFT_I2C_POWER, OUTPUT);
  digitalWrite(TFT_I2C_POWER, HIGH);
  delay(10);

  // initialize TFT
  tft.init(135, 240); // Init ST7789 240x135
  tft.setRotation(3);
  tft.fillScreen(ST77XX_BLACK);
  canvas.setFont(&FreeSansBold12pt7b);
  canvas.fillScreen(ST77XX_BLACK);

  WiFi.mode(WIFI_STA);                    //set ESP32 mode as a station to be connected to wifi network
  ThingSpeak.begin(client);               //enable ThingSpeak connection
  Wifi_Seq.reset();                       //initialize the sequencers
  Seq.reset();
  Thingspeak_seq.reset(thingspeak_delay);
}

void loop() {
  String cmd;                            //variable to hold commands we send to the kit

  Wifi_Seq.run();                        //run the sequncer to do the polling

  if (receive_command(cmd)) {            //if we sent the kit a command it gets put into the cmd variable
    polling = false;                     //we stop polling
    send_to_thingspeak = false;          //and sending data to thingspeak
    if (!process_coms(cmd)) {            //then we evaluate the cmd for kit specific commands
      process_command(cmd, device_list, device_list_len, default_board);    //then if its not kit specific, pass the cmd to the IOT command processing function
    }
  }

  if (polling == true) {                 //if polling is turned on, run the sequencer
    Seq.run();
    Thingspeak_seq.run();
  }
}

float read_sensor(Ezo_board &sensor) {
  char response[32] = {};
  auto result = sensor.receive_cmd(response, sizeof(response));
  char *end = nullptr;
  float value = strtof(response, &end);
  // Empty or malformed replies must not become zero or reuse a previous reading.
  if (result != Ezo_board::SUCCESS || end == response || *end != '\0' ||
      !isfinite(value)) value = NAN;
  if (sensor.get_address() == RTD.get_address() &&
      (value < -200.0f || value > 850.0f)) value = NAN;
  Serial.print(sensor.get_name());
  Serial.print(": ");
  if (isfinite(value)) Serial.print(value, 2);
  else Serial.print("no data");
  return value;
}

void step1() {
  //send a read command. we use this command instead of RTD.send_cmd("R");
  //to let the library know to parse the reading
  RTD.send_read_cmd();
}

void step2() {
  pending_temperature = read_sensor(RTD);
  // Keep the manufacturer's pH compensation fallback separate from measured data.
  PH.send_cmd_with_num("T,", isfinite(pending_temperature) ? pending_temperature : 25.0f);
  if (!isfinite(pending_temperature)) Serial.print(" (pH compensation assumes 25 C)");
  Serial.print(" ");
}

void step3() {
  //send a read command. we use this command instead of PH.send_cmd("R");
  //to let the library know to parse the reading
  PH.send_read_cmd();
  ORP.send_read_cmd();
}

void step4() {
  temperature = pending_temperature;
  ph_reading = read_sensor(PH);
  Serial.print("  ");
  orp_reading = read_sensor(ORP);
  Serial.println();
  readings_ready = true;
  last_reading_at = millis();

  canvas.setCursor(4, 22);
  canvas.setTextColor(ST77XX_WHITE);
  canvas.setTextWrap(true);

  canvas.fillScreen(ST77XX_BLACK);
  canvas.fillRect(0, 0, 240, 33, 0xea86);

  canvas.print("pH");
  canvas.setCursor(70, 22);
  if (isfinite(ph_reading)) {                                           //if the PH reading was successful (back in step 1)
    canvas.print(String(ph_reading));
  }else{
    canvas.print("no data");
  }

  canvas.setCursor(4, 57);
  canvas.fillRect(0, 33, 240, 33, 0x05fe);
  canvas.print("ORP");
  canvas.setCursor(70, 57);
  if (isfinite(orp_reading)) {                                           //if the EC reading was successful (back in step 1)
    canvas.print(String(orp_reading, 0));
    canvas.print(" mV");
  }else{
    canvas.print("no data");
  }

  canvas.setCursor(4, 90);
  canvas.fillRect(0, 66, 240, 33, 0xbdf8);
  canvas.print("RTD");
  canvas.setCursor(70, 90);
  if (isfinite(temperature)) {
    canvas.print(String(temperature));
    canvas.print(" C");
  } else {
    canvas.print("no data");
  }

  tft.drawRGBBitmap(0, 0, canvas.getBuffer(), canvas.width(), canvas.height());


}

void start_datalogging() {
  readings_ready = false;
  ph_reading = orp_reading = temperature = pending_temperature = NAN;
  Seq.reset();
  polling = true;                                                 //set poll to true to start the polling loop
  send_to_thingspeak = true;
  Thingspeak_seq.reset(thingspeak_delay);
}

bool process_coms(const String &string_buffer) {      //function to process commands that manipulate global variables and are specifc to certain kits
  if (string_buffer == "HELP") {
    print_help();
    return true;
  }
  else if (string_buffer.startsWith("DATALOG")) {
    start_datalogging();
    return true;
  }
  else if (string_buffer.startsWith("POLL")) {
    polling = true;
    Seq.reset();

    int16_t index = string_buffer.indexOf(',');                    //check if were passing a polling delay parameter
    if (index != -1) {                                              //if there is a polling delay
      float new_delay = string_buffer.substring(index + 1).toFloat(); //turn it into a float

      float mintime = reading_delay * 2 + 300;
      if (new_delay >= (mintime / 1000.0)) {                                     //make sure its greater than our minimum time
        Seq.set_step4_time((new_delay * 1000.0) - mintime);          //convert to milliseconds and remove the reading delay from our wait
      } else {
        Serial.println("delay too short");                          //print an error if the polling time isnt valid
      }
    }
    return true;
  }
  return false;                         //return false if the command is not in the list, so we can scan the other list or pass it to the circuit
}

void print_help() {
  Serial.println(F("AquaSense 1.0 / Atlas Scientific I2C pool kit                                              "));
  Serial.println(F("Commands:                                                                  "));
  Serial.println(F("datalog      Takes readings of all sensors every 16 sec send to thingspeak "));
  Serial.println(F("             Entering any commands stops datalog mode.                     "));
  Serial.println(F("poll         Takes readings continuously of all sensors                    "));
  Serial.println(F("                                                                           "));
  Serial.println(F("ph:cal,mid,7     calibrate to pH 7                                         "));
  Serial.println(F("ph:cal,low,4     calibrate to pH 4                                         "));
  Serial.println(F("ph:cal,high,10   calibrate to pH 10                                        "));
  Serial.println(F("ph:cal,clear     clear calibration                                         "));
  Serial.println(F("                                                                           "));
  Serial.println(F("orp:cal,225          calibrate orp probe to 225mV                          "));
  Serial.println(F("orp:cal,clear        clear calibration                                     "));
  Serial.println(F("                                                                           "));
  Serial.println(F("rtd:cal,t            calibrate the temp probe to any temp value            "));
  Serial.println(F("                     t= the temperature you have chosen                    "));
  Serial.println(F("rtd:cal,clear        clear calibration                                     "));
}
