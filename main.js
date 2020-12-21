// inspired by https://github.com/Baldanos/rd6006

var ModbusRTU = require("modbus-serial");
const serial = require('serialport');
var client = new ModbusRTU();


let main = async () => {
    var app = require('express')();
    var http = require('http').createServer(app);
    var io = require('socket.io')(http);

    app.get('/', (req, res) => {
        res.sendFile(__dirname + '/index.html');
    });

    io.on('connection', (socket) => {
        console.log('a user connected');
    });

    http.listen(3000, () => {
        console.log('listening on *:3000');
    });
    // get power supply
    let ports = await serial.list();
    let validPort;
    for (const port of ports) {
        if (port.vendorId == '1A86' && port.productId == '7523') {
            validPort = port;
        }
    }
    console.log(validPort.path);
    await client.connectRTUBuffered(validPort.path, { baudRate: 115200 });
    await client.setID(1);

    // set up RD object
    let regs = await client.readHoldingRegisters(0, 4);
    regs = regs.data;
    let serialNumber = regs[1] << 16 | regs[2];
    let firmware = regs[3] / 100;
    let type = Math.floor(regs[0] / 10);
    if (type == 6012 || type == 6018) {
        voltres = 100;
        ampres = 100;
    }
    else {
        voltres = 100;
        ampres = 1000;
    }
    let getInputVoltage = async () => {
        let volt = await client.readHoldingRegisters(14,1)
        return volt.data / voltres;
    }
    let getVoltage = async () => {
        let volt = await client.readHoldingRegisters(8,1)
        return volt.data / voltres;
    }
    let setVoltage = async (value) => {
        await client.writeRegister(8, Math.floor(value * voltres));
    }
    let getOutputEnable = async () => {
        let status = await client.readHoldingRegisters(18,1);
        return status.data[0];
    }
    let setOutputEnable = async (val) => {
        await client.writeRegister(18, val);
    }
    let getOutputCurrent = async () => {
        let current = await client.readHoldingRegisters(11,1);
        current = current.data / ampres;
        return current;
    };
    let setCurrentLimit = async (value) => {
        await client.writeRegister(9, Math.floor(value * ampres));
    }
    let getCurrentLimit = async () => {
        let current = await client.readHoldingRegisters(9,1);
        current = current.data / ampres;
        return current;
    };
    let status = async () => {
        let fullRegs = await client.readHoldingRegisters(0, 84);
        fullRegs = fullRegs.data;
        console.log("== Device")
        console.log(`Model   : ${Math.floor(fullRegs[0] / 10)}`)
        console.log(`SN      : ${(fullRegs[1] << 16 | fullRegs[2])}`)
        console.log(`Firmware: ${fullRegs[3] / 100}`)
        console.log(`Input   : ${fullRegs[14] / voltres}V`)
        if (fullRegs[4]) {
            sign = -1
        }
        else {
            sign = +1
        }
        console.log(`Temp    : ${sign * fullRegs[5]}°C`)
        if (fullRegs[34]) {
            sign = -1
        }
        else {
            sign = +1
        }
        console.log(`TempProb: ${sign * fullRegs[35]}°C`)
        console.log("== Output")
        console.log(`Voltage : ${fullRegs[10] / voltres}V`)
        console.log(`Current : ${fullRegs[11] / ampres}A`)
        console.log(`Energy  : ${fullRegs[12] / 1000}Ah`)
        console.log(`Power   : ${fullRegs[13] / 100}W`)
        console.log("== Settings")
        console.log(`Voltage : ${fullRegs[8] / voltres}V`)
        console.log(`Current : ${fullRegs[9] / ampres}A`)
        console.log("== Protection")
        console.log(`Voltage : ${fullRegs[82] / voltres}V`)
        console.log(`Current : ${fullRegs[83] / ampres}A`)
        console.log("== Battery")
        if (fullRegs[32]) {
            console.log("Active")
            console.log(`Voltage : ${fullRegs[33] / voltres}V`)
        }
        console.log(`Capacity: ${(fullRegs[38] << 16 | fullRegs[39]) / 1000}Ah`);  // TODO check 8 or 16 bits?
        console.log(`Energy  : ${(fullRegs[40] << 16 | fullRegs[41]) / 1000}Wh`);  // TODO check 8 or 16 bits?
        /*console.log("== Memories")
        for m in range(10):
            self._mem(M=m)*/
    }
    // set up event listeners
    io.on('connection', (socket) => {
        socket.on('setVoltage', (msg) => {
            console.log("Setting Voltage: ",msg);
            setVoltage(msg);
        });
        socket.on('setCurrent', (msg) => {
            console.log("Setting Current: ",msg);
            setCurrentLimit(msg);
        });
        socket.on('setOutputEnable', async () => {
            let status = await getOutputEnable();
            if (status == 0) {
                status = 1;
            }
            else {
                status = 0;
            }
            await setOutputEnable(status);
            console.log("SetOutputEnable handler", status);
        });
    });
    io.on('disconnect', (socket) => {
        console.log("disconnected");
    });
    // set up cyclic data
    setInterval(async () => {
        let outVolts = await getVoltage();
        let inVolts = await getInputVoltage();
        let outputCurrent = await getOutputCurrent();
        let currentLimit = await getCurrentLimit();
        let outputEnable = await getOutputEnable();
        io.emit('cyclicData', {
            outputVoltage: outVolts,
            inputVoltage: inVolts,
            outputCurrent: outputCurrent,
            currentLimit: currentLimit,
            outputEnable: outputEnable
        });
    }, 2500);
}

main();
