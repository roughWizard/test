google.charts.load('current', { 'packages': ['corechart'] });

let port;
let writer;
let reader;
let readBuffer = "";
let sensorData = [];
let sensorNames = [];
let chart = [];
let defaultChartOptions = {
  curveType: 'none',
  legend: { position: 'none' },
  chartArea: { width:'80%', height:'80%' },
  width: '100%',
  hAxis: {
    title: "Time (s)" ,
    viewWindow: {
      min: 0,
      max: 60
    }
  }
};
let chartOptions = [];
let chartColors = ["blue", "green", "purple"];

// Populate drop down menus for "select sensor" and "channel"
// List of recognized sensors
let sensors = [
  ["None", "none"],
  ["Ultrasonic Ranger", "ultrasonicRanger"],
  ["Photoresistor", "photoresistor"],
  ["Variable resistor", "variableResistor"],
  ["Internal accelerometer X", "internalAccelx"],
  ["Internal temperature", "internalTemp"]
];
populateFields(sensors);
function populateFields(sensors) {
  // Populate each dropdown menu with the sensor names
  [0,1,2].forEach(channel => {
    const dropdown = document.getElementById(`sensorTypeDropdown${channel}`); // Get the menu

  	sensors.forEach(sensor => {
  		const option = document.createElement("option"); // Create a new <option> element
  		option.text = sensor[0]; // Set the text of the option (the name)
  		option.value = sensor[1]; // Set the value of the option (the value)
  		dropdown.appendChild(option); // Append the option to the dropdown
  	});
  });

  // Default for channel 0
  document.getElementById("sensorTypeDropdown0").value = sensors[1][1]; // Select the first sensor after "None"
}

// Set up event listeners for buttons
document.getElementById('connectButton').addEventListener('click', connectMicrobit);
document.getElementById('recordDataButton').addEventListener('click', startRecording);
document.getElementById('stopRecordingButton').addEventListener('click', stopRecording);
document.getElementById('downloadDataButton').addEventListener('click', downloadData);
document.getElementById('sendSamplingRateButton').addEventListener('click', sendSamplingRate);


async function connectMicrobit() {
  try {
  	const selectedPort = await navigator.serial.requestPort();
  	port = selectedPort;
  	await port.open({ baudRate: 115200 });

  	// Create writer for sending data and reader for receiving data
  	writer = port.writable.getWriter();
  	reader = port.readable.getReader();
  	
  	console.log("%cMicro:bit connected.","color:orange;");
    document.getElementById("connected").hidden = false;
    document.getElementById('connectButton').disabled = true;
    document.getElementById('connectButton').textContent = "Connected to Micro:bit";
    document.getElementById('connectButton').style.backgroundColor = "limegreen";
  	document.getElementById('recordDataButton').disabled = false;

    stopRecording(); // Stop any ongoing data collection
  	readData(); // Start reading data from the microbit
    writeData("SEND_CONFIG","Fetching current config from Microbit");
    writeData("SEND_INTERVAL","Fetching current interval from Microbit");

  } catch (error) {
		console.error("Error connecting to Micro:bit:", error);
  }
}

async function readData() {
  while (port && port.readable) {
		try {
		  const { value, done } = await reader.read();
		  if (done) break;
		  if (value) {
				const text = new TextDecoder().decode(value);
				readBuffer += text;

				let lines = readBuffer.split('\n'); // String to array on with /n delimiter (makes /n disappear too)
				readBuffer = lines.pop(); // Leftover after /n (if any)

				for (let line of lines) { // Process each command one at a time (if more than one)
				  // Log incoming data before processing
				  console.log(`%cReceived data: "${line.trim()}"`,'color: red;');
				  handleIncomingData(line.trim());
				}
		  }
		} catch (error) {
		  console.error("Error reading data:", error);
      break; // Exit on error to prevent infinite loop
		}
  }
  console.log("Reader closed or disconnected.");
}

function handleIncomingData(data) {
  if (data.startsWith('DATA:')) {
    writeData('OK');  // OK to send (have to confirm to Microbit we're still listening)
    getData(data.replace("DATA:",""));

  } else if (data.startsWith('SENSOR_CONFIG:')) {
    configureWebapgeSensors(data.replace('SENSOR_CONFIG:', ''));

  } else if (data.startsWith('INTERVAL:')) {
    configureWebpageInterval(data.replace('INTERVAL:', ''));

  }
}

function getData(data) { // DATA:[time,measure1,measure2,...]
  let sensorValues = data.split(",").map( (value,i) => { // Remove identifier and make into array
    if (i == 0) { // First value is time
      value = Math.round(parseFloat(value / 1000)*10)/10; // Round to nearest 0.1
    } else { // All others are sensor readings
      value = parseFloat(value);
    }
    return value;
  })
  
  if (isNaN(sensorValues[0])) { // Errors in data ?
    console.log("Error processing data: time value not a number: ", data);
    return;
  }

  // Add to master array of values
  sensorData.push(sensorValues);

  [0,1,2].forEach(channel => {
    // Update chart data
    if (! isNaN(sensorValues[channel + 1]) && chart[channel]) { // Data present (+1 bceause of time) and chart ready ?
      drawLiveChart(channel);
    }
  });
}

// Receive current Microbit sensor configuration and configure the sensors the same on the webpage
function configureWebapgeSensors(data) { // [["photoresistor","analog","0","%"],[...]]
  try {
    const sensorConfig = JSON.parse(data.replace('SENSOR_CONFIG:', ''));

    sensorConfig.forEach((sensor,i) => {
      const dropdown = document.getElementById(`sensorTypeDropdown${i}`);

      if (sensor.length != 0 ) { // There is data
        const [sensorName,sensorMode,sensorChannel,sensorUnit] = sensor;
        dropdown.value = sensorName; // Auto-select sensor type
        
        // Change chart options for unit
        chartOptions[sensorChannel] = {
          ...defaultChartOptions,
          ...{
            title: `Channel ${sensorChannel}`,
            colors: [chartColors[sensorChannel]],
            vAxis: {
              title: `Sensor value (${sensorUnit})`
            }
          }
        }
      } else {
        dropdown.value = "none";
      }
    });

   
    // Remember sensor names in case we want to download data    
    sensorNames = sensorConfig.map(sensorData => {
      if (sensorData.length == 0) { // Empty array will return empty name
        return "";
      }
      return sensors.find(sensor => sensor[1] == sensorData[0])[0]; // Pick out just the name of the sensor
    })
     
    console.log("Sensor configuration updated:", sensorConfig);

  } catch (error) {
    console.log(`Received incorrect sensor configuration: ${data} (${error})`);
  }
}

function configureWebpageInterval(data) {
  document.getElementById('samplingRateInput').value = data;
}

function sendSamplingRate() {
  const rate = document.getElementById('samplingRateInput').value;
  
  if (rate && !isNaN(rate)) {
    // Send the SET_INTERVAL command with the rate
    const command = `SET_INTERVAL:${rate}`;
    writeData(command, "Setting sampling rate");
  } else {
    console.error("Invalid sampling rate.");
  }
}

function sendSensorConfig() {
  // Fetch all current sensors
  [0,1,2].forEach(channel => {
    const dropdown = document.getElementById(`sensorTypeDropdown${channel}`); // Get the menu
    writeData(`SET_SENSOR:${dropdown.value},${channel}`); // Send sensor configuration command
  });
}

function startRecording() {
  sendSensorConfig();
  
  [0,1,2].forEach(channel => {
    let dropdown = document.getElementById(`sensorTypeDropdown${channel}`);
    dropdown.disabled = true; // Disable dropdowns

    if (dropdown.value != "none") {
      resetChart(channel); // Prep charts
    } else {
      document.getElementById(`chart_div${channel}`).style.display = "none"; // Hide it
    }
  });

  // Start data recording command
  writeData('OK');  // OK to send
  writeData('SEND_DATA');  // Send command to start recording data

  document.getElementById('stopRecordingButton').disabled = false;
  document.getElementById('recordDataButton').disabled = true;
  document.getElementById('downloadDataButton').disabled = false;  // Enable the "Download Data" button
}

function stopRecording() {
  const command = 'STOP_DATA';
  writeData(command,"Stopping data recording");  // Stop data recording command

  document.getElementById('stopRecordingButton').disabled = true;
  document.getElementById('recordDataButton').disabled = false;
  
  // Enable dropdowns
  [0,1,2].forEach(channel => document.getElementById(`sensorTypeDropdown${channel}`).disabled = false);
}

function writeData(command,logging="") { // Default value for logging if none given
  // Log and send the data
  if (logging) {
    logging = "(" + logging + ")";
  }
  console.log(`%cSending data: "${command}" ${logging}`, 'color: green;');
  writer.write(new TextEncoder().encode(command + '\n'));  // Send data
}

function downloadData() {
  let timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  let filename = `${timestamp}.csv`;

  // Filter empty strings and join everything with commas for the name of sensors
  let separator = ","; // In case you want space separated
  let csvContent = `Time${separator}${sensorNames.filter(name => name != "").join(separator)}\n`;
  
  // Filter out empty data
  sensorData.forEach(row => {
    csvContent += `${row.filter(number => ! isNaN(number)).join(separator)}\n`;
  });

  let blob = new Blob([csvContent], { type: 'text/csv' });
  let link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

function drawLiveChart(channel) {
  let latestData = sensorData.slice(-60).map(row => [row[0], row[channel + 1]]);
  let data = new google.visualization.DataTable();
  data.addColumn('number', 'Time');
  data.addColumn('number', 'Sensor Value');
  data.addRows(latestData);

  const maxTime = latestData[latestData.length - 1][0];
  if (maxTime > chartOptions[channel].hAxis.viewWindow.max) {
    Object.assign(chartOptions[channel], {
      hAxis: {
        viewWindow: {
          max: maxTime
        }
      },
    });
  }

  chart[channel].draw(data, chartOptions[channel]);
}

function resetChart(channel) {
  sensorData = []; // Erase all previous data

  let chartDiv = document.getElementById(`chart_div${channel}`);
  chart[channel] = new google.visualization.LineChart(chartDiv);
  chartDiv.style.display = ""; // Make it visible
}