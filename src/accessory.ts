import {
  AccessoryConfig,
  AccessoryPlugin,
  API,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  HAP,
  Logging,
  Service
} from "homebridge";

import got from "got";

/*
 * IMPORTANT NOTICE
 *
 * One thing you need to take care of is, that you never ever ever import anything directly from the "homebridge" module (or the "hap-nodejs" module).
 * The above import block may seem like, that we do exactly that, but actually those imports are only used for types and interfaces
 * and will disappear once the code is compiled to Javascript.
 * In fact you can check that by running `npm run build` and opening the compiled Javascript file in the `dist` folder.
 * You will notice that the file does not contain a `... = require("homebridge");` statement anywhere in the code.
 *
 * The contents of the above import statement MUST ONLY be used for type annotation or accessing things like CONST ENUMS,
 * which is a special case as they get replaced by the actual value and do not remain as a reference in the compiled code.
 * Meaning normal enums are bad, const enums can be used.
 *
 * You MUST NOT import anything else which remains as a reference in the code, as this will result in
 * a `... = require("homebridge");` to be compiled into the final Javascript code.
 * This typically leads to unexpected behavior at runtime, as in many cases it won't be able to find the module
 * or will import another instance of homebridge causing collisions.
 *
 * To mitigate this the {@link API | Homebridge API} exposes the whole suite of HAP-NodeJS inside the `hap` property
 * of the api object, which can be acquired for example in the initializer function. This reference can be stored
 * like this for example and used to access all exported variables and classes from HAP-NodeJS.
 */
let hap: HAP;

/*
 * Initializer function called when the plugin is loaded.
 */
export = (api: API) => {
  hap = api.hap;
  api.registerAccessory("NexiaThermostat", NexiaThermostat);
};

class NexiaThermostat implements AccessoryPlugin {

  private readonly log: Logging;
  private readonly name: string;
  private switchOn = false;

  private readonly apiroute: string;
  private readonly houseId: string;
  private readonly thermostatIndex: number;
  private readonly xMobileId: string;
  private readonly xApiKey: string;
  private readonly manufacturer: string;
  private readonly model: string;
  private readonly config: any;
  private readonly serialNumber: string;
  private readonly api: any;
  private readonly Service: any;
  private readonly Characteristic: any;
  private readonly service: any;
  private readonly gotapi: any;
  private readonly characteristicMap: Map<string, any>;
  private readonly scaleMap: Map<string, any>;
  informationService: Service;
  switchService: Service;


  constructor(log: any, config: { name: string; apiroute: any; houseId: any; thermostatIndex: any; xMobileId: any; xApiKey: any; manufacturer: any; model: any; serialNumber: any; }, api: any) {
    this.log = log;
    this.config = config;
    // extract name from config
    this.name = config.name;
    this.apiroute = config.apiroute;
    this.houseId = config.houseId;
    this.thermostatIndex = config.thermostatIndex;
    this.xMobileId = config.xMobileId;
    this.xApiKey = config.xApiKey;
    this.manufacturer = config.manufacturer;
    this.model = config.model;
    this.serialNumber = config.serialNumber;
    this.api = api;
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.characteristicMap = new Map();
    this.characteristicMap.set("COOL", this.Characteristic.CurrentHeatingCoolingState.COOL);
    this.characteristicMap.set("HEAT", this.Characteristic.CurrentHeatingCoolingState.HEAT);
    this.characteristicMap.set("AUTO", this.Characteristic.CurrentHeatingCoolingState.AUTO);

    this.scaleMap = new Map();
    this.scaleMap.set("f", this.Characteristic.TemperatureDisplayUnits.FAHRENHEIT);
    this.scaleMap.set("c", this.Characteristic.TemperatureDisplayUnits.CELSIUS);



    this.gotapi = got.extend({
      prefixUrl: this.apiroute + "/houses/" + this.houseId,
      headers: {
        "X-MobileId": this.xMobileId,
        "X-ApiKey": this.xApiKey,
        "Content-Type": "application/json"
      }
    });

    // create a new Thermostat service
    this.service = new this.Service(this.Service.Thermostat);

    // create handlers for required characteristics
    this.service.getCharacteristic(this.Characteristic.CurrentHeatingCoolingState)
      .on('get', this.handleCurrentHeatingCoolingStateGet.bind(this));

    this.service.getCharacteristic(this.Characteristic.TargetHeatingCoolingState)
      .on('get', this.handleTargetHeatingCoolingStateGet.bind(this))
      .on('set', this.handleTargetHeatingCoolingStateSet.bind(this));

    this.service.getCharacteristic(this.Characteristic.CurrentTemperature)
      .on('get', this.handleCurrentTemperatureGet.bind(this));

    this.service.getCharacteristic(this.Characteristic.TargetTemperature)
      .on('get', this.handleTargetTemperatureGet.bind(this))
      .on('set', this.handleTargetTemperatureSet.bind(this));

    this.service.getCharacteristic(this.Characteristic.TemperatureDisplayUnits)
      .on('get', this.handleTemperatureDisplayUnitsGet.bind(this))
      .on('set', this.handleTemperatureDisplayUnitsSet.bind(this));

  }


  makeStatusRequest() {
    const promise = (async () => {
      const body = await this.gotapi().json;
      const rawData = body.result._links.child[0].data.items[this.thermostatIndex].zones[0];
      return rawData;
    });
    let rawData: any;
    promise().then(r => {
      rawData = r;
    }).catch(e => {
      console.log("Error getting raw data. Error = " + e.message);
      rawData = {};
    });

    return rawData;
  }
  /**
   * Handle requests to get the current value of the "Current Heating Cooling State" characteristic
   */


  computeState() {
    const rawData = this.makeStatusRequest();
    const rawMode = rawData.current_zone_mode;
    const mappedMode = this.characteristicMap.get(rawMode);
    const rawScale = rawData.features.find(e => e.name == "thermostat").scale;
    const convertedScale = this.scaleMap.get(rawScale);
    const rawTemperature = rawData.temperature;
    const rawHeatingSetPoint = rawData.heating_setpoint;
    const rawCoolingSetPoint = rawData.cooling_setpoint;
    let targetTemperature;

    if (mappedMode == this.Characteristic.CurrentHeatingCoolingState.HEAT) {
      targetTemperature = this.convertTemperature(convertedScale, rawHeatingSetPoint);
    } else {
      targetTemperature = this.convertTemperature(convertedScale, rawCoolingSetPoint);
    }

    return {
      "rawData": rawData,
      "mappedMode": mappedMode,
      "rawTemperature": rawTemperature,
      "rawScale": rawScale,
      "scale": convertedScale,
      "temperature": this.convertTemperature(convertedScale, rawTemperature),
      "heatingSetpoint": this.convertTemperature(convertedScale, rawHeatingSetPoint),
      "coolingSetpoint": this.convertTemperature(convertedScale, rawCoolingSetPoint),
      "targetTemperature": targetTemperature
    };
  }

  handleCurrentHeatingCoolingStateGet(callback: (arg0: null, arg1: any) => void) {
    this.log.debug('Triggered GET CurrentHeatingCoolingState');
    const data = this.computeState();
    callback(null, data.mappedMode);
  }

  convertFahrenheitToCelcius(value: number) {
    return (value - 32) * (5 / 9);
  }

  convertCelciusToFahrenheit(value: number) {
    return (value * (9 / 5)) + 32;
  }

  convertTemperature(scale: any, value: number) {
    const currentScale = this.Characteristic.TemperatureDisplayUnits;
    if (scale != currentScale) {
      if (currentScale == this.Characteristic.TemperatureDisplayUnits.CELSIUS) {
        return this.convertFahrenheitToCelcius(value);
      } else {
        return this.convertCelciusToFahrenheit(value);
      }
    } else {
      return value; //scale matches currentScale.
    }
  }
  /**
   * Handle requests to get the current value of the "Target Heating Cooling State" characteristic
   */
  handleTargetHeatingCoolingStateGet(callback: any) {
    this.log.debug('Triggered GET TargetHeatingCoolingState');

    this.handleCurrentTemperatureGet(callback);
  }

  /**
   * Handle requests to set the "Target Heating Cooling State" characteristic
   */
  handleTargetHeatingCoolingStateSet(value: any, callback: (arg0: null) => void) {
    this.log.debug('Triggered SET TargetHeatingCoolingState:' + value);

    callback(null);
  }

  /**
   * Handle requests to get the current value of the "Current Temperature" characteristic
   */
  handleCurrentTemperatureGet(callback: (arg0: null, arg1: number) => void) {
    this.log.debug('Triggered GET CurrentTemperature');
    const data = this.computeState();

    callback(null, data.temperature);
  }


  /**
   * Handle requests to get the current value of the "Target Temperature" characteristic
   */
  handleTargetTemperatureGet(callback: (arg0: null, arg1: number) => void) {
    this.log.debug('Triggered GET TargetTemperature');

    const data = this.computeState();

    callback(null, data.targetTemperature);
  }

  /**
   * Handle requests to set the "Target Temperature" characteristic
   */
  handleTargetTemperatureSet(value: any, callback: (arg0: null) => void) {
    this.log.debug('Triggered SET TargetTemperature:' + value);

    callback(null);
  }

  /**
   * Handle requests to get the current value of the "Temperature Display Units" characteristic
   */
  handleTemperatureDisplayUnitsGet(callback: (arg0: null, arg1: any) => void) {
    this.log.debug('Triggered GET TemperatureDisplayUnits');

    const data = this.computeState();

    callback(null, data.scale);
  }

  /**
   * Handle requests to set the "Temperature Display Units" characteristic
   */
  handleTemperatureDisplayUnitsSet(value: any, callback: (arg0: null) => void) {
    this.log.debug('Triggered SET TemperatureDisplayUnits:' + value);

    callback(null);
  }

  /*
   * This method is optional to implement. It is called when HomeKit ask to identify the accessory.
   * Typical this only ever happens at the pairing process.
   */
  identify(): void {
    this.log("Homebridge-Nexia!");
  }

  /*
   * This method is called directly after creation of this instance.
   * It should return all services which should be added to the accessory.
   */
  getServices(): Service[] {
    return [
      this.informationService,
      this.switchService,
    ];
  }

}