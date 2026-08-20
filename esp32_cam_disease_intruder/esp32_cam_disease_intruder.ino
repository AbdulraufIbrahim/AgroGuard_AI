#include <Arduino.h>
#include "esp_camera.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include "mbedtls/base64.h"
#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Copy secrets.example.h to secrets.h and fill in your Wi-Fi and Telegram values."
#endif

#ifndef FIREBASE_EMAIL_VALUE
#define FIREBASE_EMAIL_VALUE "ibraniger001@gmail.com"
#endif

#ifndef FIREBASE_PASSWORD_VALUE
#define FIREBASE_PASSWORD_VALUE "oluwaseun"
#endif

// =======================
// WIFI SETTINGS
// =======================
const char* WIFI_SSID = WIFI_SSID_VALUE;
const char* WIFI_PASSWORD = WIFI_PASSWORD_VALUE;

// =======================
// HUGGING FACE API
// =======================
const char* HF_HOST = "AbdulraufIbrahim-plant-disease-api.hf.space";
const char* HF_PATH = "/predict";

// =======================
// TELEGRAM SETTINGS
// =======================
String BOT_TOKEN = TELEGRAM_BOT_TOKEN_VALUE;
String CHAT_ID = TELEGRAM_CHAT_ID_VALUE;

// =======================
// FIREBASE SETTINGS
// =======================
String FIREBASE_URL = "https://plant-disease-dectection-001-default-rtdb.europe-west1.firebasedatabase.app";
String FIREBASE_API_KEY = "AIzaSyCUqBs9NqWzMCWe7PbGgZLhmp85gBhwcoM";
String FIREBASE_EMAIL = FIREBASE_EMAIL_VALUE;
String FIREBASE_PASSWORD = FIREBASE_PASSWORD_VALUE;
String FIREBASE_AUTH = "";
String FIREBASE_REFRESH_TOKEN = "";
unsigned long firebaseTokenExpiresAtMs = 0;

// Set false if the ESP becomes unstable from large image writes.
const bool STORE_IMAGES_IN_RTDB = true;

// Nigeria/Lagos time.
const long GMT_OFFSET_SEC = 3600;
const int DAYLIGHT_OFFSET_SEC = 0;

// =======================
// AI THINKER ESP32-CAM PINS
// =======================
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// External components.
#define PIR_PIN           13
#define BUZZER_PIN        12
#define FLASH_LED_PIN      4

unsigned long lastCommandPoll = 0;
unsigned long commandPollInterval = 3000;

bool dailyDiseaseActive = false;
String dailyDiseaseTimes = "";
String lastSnapDate = "";
String lastSnapTimeStr = "";

bool intruderArmed = false;
unsigned long lastIntruderSnap = 0;
unsigned long intruderCooldownMs = 10000;

String jsonEscape(String value) {
  value.replace("\\", "\\\\");
  value.replace("\"", "\\\"");
  value.replace("\n", "\\n");
  value.replace("\r", "\\r");
  value.replace("\t", "\\t");
  return value;
}

void soundBuzzer(int pin, int times, int delayMs) {
  for (int i = 0; i < times; i++) {
    digitalWrite(pin, HIGH);
    delay(delayMs);
    digitalWrite(pin, LOW);
    delay(delayMs);
  }
}

String getTimestampString() {
  time_t now = time(nullptr);
  if (now < 100000) return String(millis());

  struct tm* timeinfo = localtime(&now);
  char buffer[30];
  strftime(buffer, sizeof(buffer), "%Y-%m-%d %H:%M:%S", timeinfo);
  return String(buffer);
}

String getTimestampKey() {
  time_t now = time(nullptr);
  if (now < 100000) return String(millis());
  return String((unsigned long)now);
}

String firebaseUrl(String path) {
  String url = FIREBASE_URL + path + ".json";
  if (FIREBASE_AUTH.length() > 0) {
    url += "?auth=" + FIREBASE_AUTH;
  }
  return url;
}

bool firebaseSignIn() {
  if (FIREBASE_EMAIL.length() == 0 || FIREBASE_PASSWORD.length() == 0 ||
      FIREBASE_EMAIL == "your-firebase-email@example.com" ||
      FIREBASE_PASSWORD == "your-firebase-password") {
    Serial.println("Firebase auth skipped: fill FIREBASE_EMAIL_VALUE and FIREBASE_PASSWORD_VALUE in secrets.h.");
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  String url = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + FIREBASE_API_KEY;

  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");

  String body = "{";
  body += "\"email\":\"" + jsonEscape(FIREBASE_EMAIL) + "\",";
  body += "\"password\":\"" + jsonEscape(FIREBASE_PASSWORD) + "\",";
  body += "\"returnSecureToken\":true";
  body += "}";

  int code = http.POST(body);
  String payload = http.getString();
  http.end();

  if (code != 200) {
    Serial.printf("Firebase sign-in failed: HTTP %d\n", code);
    if (payload.length() > 0) Serial.println(payload);
    FIREBASE_AUTH = "";
    firebaseTokenExpiresAtMs = 0;
    return false;
  }

  StaticJsonDocument<6144> doc;
  DeserializationError error = deserializeJson(doc, payload);
  if (error) {
    Serial.print("Firebase sign-in JSON parse failed: ");
    Serial.println(error.c_str());
    FIREBASE_AUTH = "";
    firebaseTokenExpiresAtMs = 0;
    return false;
  }

  FIREBASE_AUTH = String(doc["idToken"] | "");
  FIREBASE_REFRESH_TOKEN = String(doc["refreshToken"] | "");
  unsigned long expiresInSec = String(doc["expiresIn"] | "3600").toInt();

  if (FIREBASE_AUTH.length() == 0) {
    Serial.println("Firebase sign-in failed: missing idToken.");
    firebaseTokenExpiresAtMs = 0;
    return false;
  }

  unsigned long usableTokenMs = expiresInSec > 300 ? (expiresInSec - 300) * 1000UL : expiresInSec * 1000UL;
  firebaseTokenExpiresAtMs = millis() + usableTokenMs;

  Serial.println("Firebase sign-in successful.");
  return true;
}

bool firebaseEnsureAuth() {
  if (FIREBASE_AUTH.length() > 0 && (long)(firebaseTokenExpiresAtMs - millis()) > 0) {
    return true;
  }

  return firebaseSignIn();
}

String firebaseGET(String path) {
  if (!firebaseEnsureAuth()) {
    Serial.printf("Firebase GET skipped %s: not authenticated\n", path.c_str());
    return "";
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.begin(client, firebaseUrl(path));
  int code = http.GET();

  if (code == 401 || code == 403) {
    http.end();
    FIREBASE_AUTH = "";
    firebaseTokenExpiresAtMs = 0;

    if (!firebaseEnsureAuth()) {
      Serial.printf("Firebase GET retry skipped %s: re-auth failed\n", path.c_str());
      return "";
    }

    http.begin(client, firebaseUrl(path));
    code = http.GET();
  }

  String payload = "";
  if (code >= 200 && code < 300) {
    payload = http.getString();
  } else {
    Serial.printf("Firebase GET failed %s: HTTP %d\n", path.c_str(), code);
    String err = http.getString();
    if (err.length() > 0) Serial.println(err);
  }

  http.end();
  return payload;
}

bool firebasePUT(String path, String json) {
  if (!firebaseEnsureAuth()) {
    Serial.printf("Firebase PUT skipped %s: not authenticated\n", path.c_str());
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.begin(client, firebaseUrl(path));
  http.addHeader("Content-Type", "application/json");
  int code = http.PUT(json);

  if (code == 401 || code == 403) {
    http.end();
    FIREBASE_AUTH = "";
    firebaseTokenExpiresAtMs = 0;

    if (!firebaseEnsureAuth()) {
      Serial.printf("Firebase PUT retry skipped %s: re-auth failed\n", path.c_str());
      return false;
    }

    http.begin(client, firebaseUrl(path));
    http.addHeader("Content-Type", "application/json");
    code = http.PUT(json);
  }

  if (code < 200 || code >= 300) {
    Serial.printf("Firebase PUT failed %s: HTTP %d\n", path.c_str(), code);
    String err = http.getString();
    if (err.length() > 0) Serial.println(err);
  }

  http.end();
  return code >= 200 && code < 300;
}

bool firebaseSetBool(String path, bool value) {
  return firebasePUT(path, value ? "true" : "false");
}

bool firebaseSetString(String path, String value) {
  return firebasePUT(path, "\"" + jsonEscape(value) + "\"");
}

bool firebaseGetBool(String path, bool defaultValue) {
  String payload = firebaseGET(path);
  payload.trim();
  if (payload == "true") return true;
  if (payload == "false") return false;
  return defaultValue;
}

String encodeBase64(uint8_t* data, size_t length) {
  size_t outputLength = 0;
  mbedtls_base64_encode(nullptr, 0, &outputLength, data, length);

  unsigned char* base64Buffer = (unsigned char*)malloc(outputLength + 1);
  if (!base64Buffer) {
    Serial.println("Base64 malloc failed.");
    return "";
  }

  int ret = mbedtls_base64_encode(base64Buffer, outputLength, &outputLength, data, length);
  if (ret != 0) {
    Serial.printf("Base64 encode failed: %d\n", ret);
    free(base64Buffer);
    return "";
  }

  base64Buffer[outputLength] = '\0';
  String result = String((char*)base64Buffer);
  free(base64Buffer);
  return result;
}

void decodeBase64(String base64Str, uint8_t** buffer, size_t* length) {
  *buffer = nullptr;
  *length = 0;

  int commaIndex = base64Str.indexOf(",");
  if (commaIndex >= 0) {
    base64Str = base64Str.substring(commaIndex + 1);
  }

  base64Str.trim();

  size_t outputLength = 0;
  int ret = mbedtls_base64_decode(
    nullptr,
    0,
    &outputLength,
    (const unsigned char*)base64Str.c_str(),
    base64Str.length()
  );

  if (ret != MBEDTLS_ERR_BASE64_BUFFER_TOO_SMALL && ret != 0) {
    Serial.printf("Base64 decode size check failed: %d\n", ret);
    return;
  }

  *buffer = (uint8_t*)malloc(outputLength);
  if (!*buffer) {
    Serial.println("Base64 decode malloc failed.");
    return;
  }

  ret = mbedtls_base64_decode(
    *buffer,
    outputLength,
    &outputLength,
    (const unsigned char*)base64Str.c_str(),
    base64Str.length()
  );

  if (ret != 0) {
    Serial.printf("Base64 decode failed: %d\n", ret);
    free(*buffer);
    *buffer = nullptr;
    *length = 0;
    return;
  }

  *length = outputLength;
}

String dechunkBody(String body) {
  String decoded = "";
  int index = 0;

  while (index < body.length()) {
    int lineEnd = body.indexOf("\r\n", index);
    if (lineEnd < 0) break;

    String sizeStr = body.substring(index, lineEnd);
    sizeStr.trim();
    int semi = sizeStr.indexOf(";");
    if (semi >= 0) sizeStr = sizeStr.substring(0, semi);

    int chunkSize = strtol(sizeStr.c_str(), nullptr, 16);
    if (chunkSize <= 0) break;

    index = lineEnd + 2;
    if (index + chunkSize > body.length()) break;

    decoded += body.substring(index, index + chunkSize);
    index += chunkSize + 2;
  }

  return decoded.length() > 0 ? decoded : body;
}

String extractHttpBody(String response) {
  bool chunked = response.indexOf("Transfer-Encoding: chunked") >= 0 ||
                 response.indexOf("transfer-encoding: chunked") >= 0;

  int bodyIndex = response.indexOf("\r\n\r\n");
  if (bodyIndex >= 0) response = response.substring(bodyIndex + 4);
  if (chunked) response = dechunkBody(response);

  response.trim();
  return response;
}

void connectWiFi() {
  Serial.print("Connecting to WiFi: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int tries = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    tries++;
    if (tries > 60) {
      Serial.println("\nWiFi connection failed. Restarting...");
      ESP.restart();
    }
  }

  Serial.println("\nWiFi connected.");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
}

void setupTime() {
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, "pool.ntp.org", "time.nist.gov");

  Serial.print("Syncing time");
  int tries = 0;
  while (time(nullptr) < 100000 && tries < 30) {
    Serial.print(".");
    delay(500);
    tries++;
  }
  Serial.println();

  if (time(nullptr) < 100000) {
    Serial.println("Time sync failed.");
  } else {
    Serial.print("Time synced: ");
    Serial.println(getTimestampString());
  }
}

void updateDeviceStatus(String message) {
  String json = "{";
  json += "\"message\":\"" + jsonEscape(message) + "\",";
  json += "\"timestamp\":\"" + jsonEscape(getTimestampString()) + "\",";
  json += "\"timestampEpoch\":" + String((unsigned long)time(nullptr));
  json += "}";
  firebasePUT("/status/latest", json);
}

void setupCamera() {
  // Important for 0x106 ESP_ERR_NOT_SUPPORTED on some modules.
  pinMode(PWDN_GPIO_NUM, OUTPUT);
  digitalWrite(PWDN_GPIO_NUM, HIGH);
  delay(20);
  digitalWrite(PWDN_GPIO_NUM, LOW);
  delay(200);

  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;

#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
#else
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
#endif

  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = FRAMESIZE_QVGA;
  config.jpeg_quality = 12;
  config.fb_count = 1;

  if (psramFound()) {
    config.fb_count = 2;
    config.grab_mode = CAMERA_GRAB_LATEST;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed at 20 MHz: 0x%x\n", err);
    Serial.println("Retrying camera init at 10 MHz...");
    config.xclk_freq_hz = 10000000;
    delay(200);
    err = esp_camera_init(&config);
  }

  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", err);
    Serial.println("Check board: AI Thinker ESP32-CAM, PSRAM enabled if available, stable 5V power, camera ribbon orientation, and camera module seating.");
    updateDeviceStatus("Camera init failed");
    while (true) {
      soundBuzzer(BUZZER_PIN, 1, 300);
    }
  }

  sensor_t* sensor = esp_camera_sensor_get();
  if (sensor) {
    sensor->set_framesize(sensor, FRAMESIZE_QVGA);
    sensor->set_quality(sensor, 12);
  }

  Serial.println("Camera initialized.");
}

String postImageToHuggingFace(uint8_t* buf, size_t len) {
  WiFiClientSecure client;
  client.setInsecure();

  if (!client.connect(HF_HOST, 443)) {
    Serial.println("HF connection failed.");
    return "";
  }

  String boundary = "----ESP32CAMDiseaseBoundary";
  String head = "--" + boundary + "\r\n";
  head += "Content-Disposition: form-data; name=\"file\"; filename=\"plant.jpg\"\r\n";
  head += "Content-Type: image/jpeg\r\n\r\n";

  String tail = "\r\n--" + boundary + "--\r\n";
  int contentLength = head.length() + len + tail.length();

  client.print("POST ");
  client.print(HF_PATH);
  client.println(" HTTP/1.1");
  client.print("Host: ");
  client.println(HF_HOST);
  client.println("Connection: close");
  client.print("Content-Type: multipart/form-data; boundary=");
  client.println(boundary);
  client.print("Content-Length: ");
  client.println(contentLength);
  client.println();

  client.print(head);
  client.write(buf, len);
  client.print(tail);

  String response = "";
  unsigned long timeout = millis();
  while (client.connected() && millis() - timeout < 30000) {
    while (client.available()) {
      response += (char)client.read();
      timeout = millis();
    }
    delay(1);
  }
  while (client.available()) response += (char)client.read();

  client.stop();
  return extractHttpBody(response);
}

String sendDownloadedImageToHuggingFace(uint8_t* buf, size_t len) {
  return postImageToHuggingFace(buf, len);
}

bool sendTelegramMessage(String message) {
  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  String url = "https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage";
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");

  String json = "{\"chat_id\":\"" + jsonEscape(CHAT_ID) + "\",\"text\":\"" + jsonEscape(message) + "\"}";
  int code = http.POST(json);

  if (code != 200) Serial.printf("Telegram message failed: HTTP %d\n", code);
  http.end();
  return code == 200;
}

bool sendTelegramPhoto(camera_fb_t* fb, String caption) {
  WiFiClientSecure client;
  client.setInsecure();

  if (!client.connect("api.telegram.org", 443)) {
    Serial.println("Telegram connection failed.");
    return false;
  }

  String path = "/bot" + BOT_TOKEN + "/sendPhoto";
  String boundary = "----ESP32CAMIntruderBoundary";

  String head = "--" + boundary + "\r\n";
  head += "Content-Disposition: form-data; name=\"chat_id\"\r\n\r\n";
  head += CHAT_ID + "\r\n";
  head += "--" + boundary + "\r\n";
  head += "Content-Disposition: form-data; name=\"caption\"\r\n\r\n";
  head += caption + "\r\n";
  head += "--" + boundary + "\r\n";
  head += "Content-Disposition: form-data; name=\"photo\"; filename=\"intruder.jpg\"\r\n";
  head += "Content-Type: image/jpeg\r\n\r\n";

  String tail = "\r\n--" + boundary + "--\r\n";
  int contentLength = head.length() + fb->len + tail.length();

  client.print("POST ");
  client.print(path);
  client.println(" HTTP/1.1");
  client.println("Host: api.telegram.org");
  client.println("Connection: close");
  client.print("Content-Type: multipart/form-data; boundary=");
  client.println(boundary);
  client.print("Content-Length: ");
  client.println(contentLength);
  client.println();

  client.print(head);
  client.write(fb->buf, fb->len);
  client.print(tail);

  String response = "";
  unsigned long timeout = millis();
  while (client.connected() && millis() - timeout < 30000) {
    while (client.available()) {
      response += (char)client.read();
      timeout = millis();
    }
    delay(1);
  }
  while (client.available()) response += (char)client.read();

  client.stop();
  bool ok = response.indexOf("\"ok\":true") >= 0;
  if (!ok) {
    Serial.println("Telegram photo failed.");
    Serial.println(response);
  }
  return ok;
}

void runDiseaseDetection(String source) {
  updateDeviceStatus("Capturing plant image for disease detection");

  digitalWrite(FLASH_LED_PIN, HIGH);
  delay(200);
  camera_fb_t* fb = esp_camera_fb_get();
  digitalWrite(FLASH_LED_PIN, LOW);

  if (!fb) {
    updateDeviceStatus("Plant image capture failed");
    return;
  }

  String response = postImageToHuggingFace(fb->buf, fb->len);
  String base64Img = "";
  if (STORE_IMAGES_IN_RTDB && source == "manual") {
    base64Img = encodeBase64(fb->buf, fb->len);
  }

  esp_camera_fb_return(fb);

  if (response.length() == 0) {
    updateDeviceStatus("Disease API failed");
    sendTelegramMessage("Disease detection failed: no response from cloud API.");
    return;
  }

  Serial.println("HF response body:");
  Serial.println(response);

  StaticJsonDocument<8192> doc;
  DeserializationError error = deserializeJson(doc, response);
  if (error) {
    updateDeviceStatus("Disease result JSON parse failed");
    Serial.print("JSON parse error: ");
    Serial.println(error.c_str());
    return;
  }

  String label = doc["label"] | "unknown";
  float confidence = doc["confidence"] | 0.0;
  String timestamp = getTimestampString();

  String diseaseJson = "{";
  diseaseJson += "\"label\":\"" + jsonEscape(label) + "\",";
  diseaseJson += "\"confidence\":" + String(confidence, 6) + ",";
  diseaseJson += "\"source\":\"" + jsonEscape(source) + "\",";
  diseaseJson += "\"timestamp\":\"" + jsonEscape(timestamp) + "\"";
  if (base64Img.length() > 0) diseaseJson += ",\"imageBase64\":\"" + base64Img + "\"";
  diseaseJson += "}";

  String tsKey = getTimestampKey();
  firebasePUT("/disease/latest", diseaseJson);
  firebasePUT("/disease/history/" + tsKey, diseaseJson);

  String msg = "Plant Disease Detection Result\n";
  msg += "Label: " + label + "\n";
  msg += "Confidence: " + String(confidence, 4) + "\n";
  msg += "Source: " + source + "\n";
  msg += "Time: " + timestamp;
  sendTelegramMessage(msg);

  updateDeviceStatus("Disease detection completed: " + label);
}

void captureIntruder(String source) {
  updateDeviceStatus("Capturing intruder image");
  soundBuzzer(BUZZER_PIN, 5, 200);

  digitalWrite(FLASH_LED_PIN, HIGH);
  delay(300);
  camera_fb_t* fb = esp_camera_fb_get();
  digitalWrite(FLASH_LED_PIN, LOW);

  if (!fb) {
    updateDeviceStatus("Intruder image capture failed");
    return;
  }

  String timestamp = getTimestampString();
  String caption = "Intruder Alert!\nSource: " + source + "\nTime: " + timestamp;
  bool telegramSent = sendTelegramPhoto(fb, caption);

  String base64Image = "";
  if (STORE_IMAGES_IN_RTDB) {
    base64Image = encodeBase64(fb->buf, fb->len);
  }

  esp_camera_fb_return(fb);

  String intruderJson = "{";
  intruderJson += "\"event\":\"intruder_capture\",";
  intruderJson += "\"source\":\"" + jsonEscape(source) + "\",";
  intruderJson += "\"telegramSent\":" + String(telegramSent ? "true" : "false") + ",";
  intruderJson += "\"timestamp\":\"" + jsonEscape(timestamp) + "\"";
  if (base64Image.length() > 0) intruderJson += ",\"imageBase64\":\"" + base64Image + "\"";
  intruderJson += "}";

  String tsKey = getTimestampKey();
  firebasePUT("/intruder/latest", intruderJson);
  firebasePUT("/intruder/history/" + tsKey, intruderJson);

  updateDeviceStatus("Intruder image processed");
}

void processManualPlantUploadBase64(String base64Str) {
  updateDeviceStatus("Decoding web upload");

  uint8_t* buff = nullptr;
  size_t len = 0;

  decodeBase64(base64Str, &buff, &len);

  String response = "";
  if (buff && len > 0) {
    updateDeviceStatus("Sending web upload to HF");
    response = sendDownloadedImageToHuggingFace(buff, len);
    free(buff);
  } else {
    updateDeviceStatus("Failed to decode base64 image");
  }

  if (response.length() == 0) {
    updateDeviceStatus("Disease API failed for web upload");
    sendTelegramMessage("Disease detection failed for uploaded image.");
    return;
  }

  Serial.println("HF upload response body:");
  Serial.println(response);

  StaticJsonDocument<8192> doc;
  DeserializationError error = deserializeJson(doc, response);
  if (error) {
    updateDeviceStatus("Disease result JSON parse failed");
    Serial.print("JSON parse error: ");
    Serial.println(error.c_str());
    return;
  }

  String label = doc["label"] | "unknown";
  float confidence = doc["confidence"] | 0.0;
  String timestamp = getTimestampString();

  String diseaseJson = "{";
  diseaseJson += "\"label\":\"" + jsonEscape(label) + "\",";
  diseaseJson += "\"confidence\":" + String(confidence, 6) + ",";
  diseaseJson += "\"source\":\"manual upload\",";
  diseaseJson += "\"timestamp\":\"" + jsonEscape(timestamp) + "\"";
  if (STORE_IMAGES_IN_RTDB) diseaseJson += ",\"imageUrl\":\"" + jsonEscape(base64Str) + "\"";
  diseaseJson += "}";

  String tsKey = getTimestampKey();
  firebasePUT("/plant/manual/latest", diseaseJson);
  firebasePUT("/disease/latest", diseaseJson);
  firebasePUT("/disease/history/" + tsKey, diseaseJson);

  String msg = "Manual Plant Upload Result\n";
  msg += "Label: " + label + "\n";
  msg += "Confidence: " + String(confidence, 4) + "\n";
  msg += "Time: " + timestamp;
  sendTelegramMessage(msg);

  updateDeviceStatus("Manual upload processed: " + label);
}

void pollFirebaseCommands() {
  intruderArmed = firebaseGetBool("/control/intruderArmed", false);
  dailyDiseaseActive = firebaseGetBool("/control/dailyDiseaseActive", false);

  String timesStr = firebaseGET("/config/dailyDiseaseTimes");
  timesStr.trim();
  timesStr.replace("\"", "");
  if (timesStr == "null") timesStr = "";
  dailyDiseaseTimes = timesStr;

  if (firebaseGetBool("/commands/diseaseSnap", false)) {
    firebaseSetBool("/commands/diseaseSnap", false);
    runDiseaseDetection("manual");
  }

  if (firebaseGetBool("/commands/intruderSnap", false)) {
    firebaseSetBool("/commands/intruderSnap", false);
    captureIntruder("manual dashboard snap");
  }

  if (firebaseGetBool("/commands/plantManualSnap", false)) {
    firebaseSetBool("/commands/plantManualSnap", false);

    String base64Data = firebaseGET("/commands/plantManualUploadBase64");
    base64Data.trim();

    if (base64Data.startsWith("\"") && base64Data.endsWith("\"")) {
      base64Data = base64Data.substring(1, base64Data.length() - 1);
    }

    base64Data.replace("\\/", "/");

    if (base64Data.length() > 100) {
      processManualPlantUploadBase64(base64Data);
      firebaseSetString("/commands/plantManualUploadBase64", "");
    } else {
      updateDeviceStatus("Manual upload command had no image data");
    }
  }

  time_t nowEpoch = time(nullptr);
  String statusJson = "{";
  statusJson += "\"online\":" + String((WiFi.status() == WL_CONNECTED) ? "true" : "false") + ",";
  statusJson += "\"intruderArmed\":" + String(intruderArmed ? "true" : "false") + ",";
  statusJson += "\"dailyDiseaseActive\":" + String(dailyDiseaseActive ? "true" : "false") + ",";
  statusJson += "\"dailyDiseaseTimes\":\"" + jsonEscape(dailyDiseaseTimes) + "\",";
  statusJson += "\"lastSeen\":\"" + jsonEscape(getTimestampString()) + "\",";
  statusJson += "\"lastSeenEpoch\":" + String((unsigned long)nowEpoch);
  statusJson += "}";
  firebasePUT("/status/device", statusJson);
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(PIR_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(FLASH_LED_PIN, LOW);

  connectWiFi();
  setupTime();
  setupCamera();
  firebaseEnsureAuth();

  updateDeviceStatus("ESP32-CAM online");
  sendTelegramMessage("ESP32-CAM Disease + Intruder System is online.");
  Serial.println("System ready.");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  unsigned long now = millis();

  if (now - lastCommandPoll >= commandPollInterval) {
    lastCommandPoll = now;
    pollFirebaseCommands();
  }

  if (dailyDiseaseActive && dailyDiseaseTimes.length() >= 5) {
    time_t tnow = time(nullptr);
    if (tnow > 100000) {
      struct tm* timeinfo = localtime(&tnow);

      char dateBuf[15];
      char timeBuf[10];
      strftime(dateBuf, sizeof(dateBuf), "%Y-%m-%d", timeinfo);
      strftime(timeBuf, sizeof(timeBuf), "%H:%M", timeinfo);

      String currentDate = String(dateBuf);
      String currentTime = String(timeBuf);
      String searchStr = "," + dailyDiseaseTimes + ",";
      String target = "," + currentTime + ",";

      if (searchStr.indexOf(target) >= 0) {
        if (lastSnapDate != currentDate || lastSnapTimeStr != currentTime) {
          lastSnapDate = currentDate;
          lastSnapTimeStr = currentTime;
          runDiseaseDetection("scheduled time " + currentTime);
        }
      }
    }
  }

  if (intruderArmed) {
    int pirState = digitalRead(PIR_PIN);
    if (pirState == HIGH && now - lastIntruderSnap >= intruderCooldownMs) {
      lastIntruderSnap = now;
      captureIntruder("PIR motion");
    }
  }

  delay(100);
}
