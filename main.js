const { createClient } = require('redis');
const net = require("net");
const { lookup } = require("dns");

class ProxyIP extends Object {

	/* Initialize
	parameters:
		ports: array of ports to check
		redisConnectionString: redis connection string
	*/
	constructor(ports = [], redisConnectionString = "") {
		super();
		if (ports.length === 0) {
			ports = require("./ports.js").ports;
			console.log("No ports provided, using default ports");
			console.log(ports);
		}
		this.setPorts(ports);

		this.redisConnectionString = redisConnectionString;
		this.redisClient = null;
		this.InitializeRedisConnection();
	}
	//methods
	getPorts() {
		return this.ports;
	}
	setPorts(ports) {
		//check if ports is an array and 0-65535
		if (ports instanceof Array && ports.length > 0 && ports.every( (port) => port >= 0 && port <= 65535)) {
			this.ports = ports;
		}
		else {
			throw new Error("Invalid ports");
		}
	}

	async InitializeRedisConnection() {
		const url = this.redisConnectionString;
		const c = createClient({ url: url });
		await c.connect();
		c.on('connect', () => {
			console.log('Connected to Redis');
		});
		c.on('error', err => {
			console.log('Error ' + err);
			throw new Error("Error connecting to Redis");
		});
		this.redisClient = c;
		await this.redisClient.del("ports");
		for (let i = 0; i < this.ports.length; i++) {
			//push ports as ports set
			await this.redisClient.sAdd("ports", this.ports[i]);
		}
	}

	IsProxyIP(ip) {
		return new Promise(async (resolve, reject) => {
			//check on redis if ip is in list not not

			//get all "ProxyIPs" from redis and check if ip is in list
			const proxyIPs = await this.redisClient.lRange("ProxyIPs", 0, -1);
			if (proxyIPs.includes(ip)) {
				console.log(`${ip} is contained in ProxyIPs list in redis`);
				resolve(true);
			}
			else {
				const promises = [];
				const ret = await this.IsTorExitNode(ip);
				if (ret) {
					await this.redisClient.rPush("ProxyIPs", ip);
					resolve(true);
					return;
				}
				for (let i = 0; i < this.ports.length; i++) {
					promises.push(this.IsTCPSocketOpen(ip, this.ports[i]));
				}
				//check any port is open
				const isOpen = await Promise.any(promises);
				if (isOpen) {
					//push to redis list
					await this.redisClient.rPush("ProxyIPs", ip);
					resolve(true);
				}
				const allPromises = await Promise.all(promises);
				if (allPromises.every((x) => x === false)) {
					console.log(`${ip} is not a proxy IP`);
					resolve(false);
				}
			}
		});
	}
	IsTorExitNode(ip) {
		return new Promise((resolve, reject) => {
			try {
				const ip_rev = ip.split(".").reverse().join(".");
				const domain = `${ip_rev}.dnsel.torproject.org`;
				lookup(domain, (err, address, family) => {
					if (err) {
						resolve(false);
					}
					/* console.log(`Address family: ${family}`);
					console.log(`Address: ${address}`); */
					if (address === "127.0.0.1" || address === "127.0.0.2") {
						console.log(`${ip} is a Tor exit node`);
						console.log(`${domain} resolved to ${address}`);
						resolve(true);
					}
					else {
						resolve(false);
					}
				});
			} catch (err) {
				console.log(err);
				resolve(false);
			}
		});
	}

	IsTCPSocketOpen(ip, port) {
		return new Promise((resolve, reject) => {
			try {
				const client = new net.Socket();
				//timeout after 2 seconds
				client.setTimeout(2000);
				client.connect(port, ip, () => {
					console.log(`${ip}:${port} is open`);
					//console.log("Hello, server! Love, Client.");
					resolve(true);
				});
				client.on("data", (data) => {
					//console.log("Received: " + data);
				});
				client.on("close", () => {
					//console.log("Connection closed");
				});
				client.on("error", (err) => {
					//console.log("Error: " + err);
					reject(false);
				});
				client.write("Hello, server! Love, Client.");
			} catch (err) {
				console.log(err);
				reject(false);
			}
		});
	}
}



setTimeout(async function () {
	const proxyIP = new ProxyIP([], `redis://default:@localhost:16475`);
	await proxyIP.InitializeRedisConnection();

	const ret = await proxyIP.IsProxyIP("109.70.100.27");
	console.log(`result: ${ret}`);
}, 1000);



process.on('unhandledRejection', (reason, promise) => {
	///console.log('Unhandled Rejection at:', promise, 'reason:', reason);
	//console.log(reason);
	// Application specific logging, throwing an error, or other logic here
});

module.exports = { ProxyIP };

//https://drive.google.com/file/d/1qMZN9jpgnBQxHAbe7Tq-z5W3aK100hJE/view?usp=sharing