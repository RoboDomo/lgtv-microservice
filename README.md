# lgtv-microservice
MQTT  microservice for LG TVs

This microservice communicates with LG TVs and bridges control and status via MQTT.

## Docker build instructions
You can neatly package this microservice as a Docker container:

```
$ docker build -t lgtv-microservice .
```

(There is a build.sh script that will do the build command for you)

## Docker run instructions

To run it:

```
$ docker run \
    -d \
    -e "LGTV_HOSTS=host[,host,host...]" \
    --rm \
    --name="lgtv-microservice"
    lgtv-microservice
```

(There is a run.sh script that will do the run command for you)

*NOTE* lgtv-microservice expects LGTV_HOSTS env variable set to "hostname;mac[,hostname;mac...]"

mac address is required for WOL to power on tv.


To restart it:
```
$ docker restart lgtv-micorservice
```

## Diagnosing Docker container
There is a handy shell.sh script that will give you a bash shell in a new instantiated container.

When you exit the shell, the container is stopped/removed.

You can also use the included debug.sh script which runs the container not as a daemon, so you can see the logging output in the console.

## DNS Issues
By default, Docker looks at the host's /etc/resolv.conf file for DNS servers for the containers.

In my setup, I have dnsmasq doing DHCP and DNS, on one of my computers, for my entire LAN.  When a system gets an IP from DHCP, it also gets the IP address of my dnsmasq host.

My /etc/resolv.conf file has one line in it:
```
nameserver 127.0.0.1
```

It is tricky for Docker to set up DNS in this situation without some help.  It does not
set the containers' DNS servers to the Docker host with name server 127.0.0.1 (e.g. to the docker bridge netwrok).
If it did, you would have to set up your dnsmasq instance to listen on the host's IP address on the docker bridge, too.

There is a perfectly fine global setup for Docker that works as we want.  Simply add a /etc/docker/daemon.json file (or edit any existing one)
with this (my DNS host is 192.168.0.17, fix the "dns" below to point at yours):

```
{
    "dns": ["192.168.0.17", "8.8.8.8"]
}
```

And restart the docker service.

NOTE: you will need to do this on any machines on your LAN that act as Docker hosts!  In my case,
I have a development machine and production machine that both host microservices and the WWW site
containers.  I had to do this procedure on both.

See: https://robinwinslow.uk/2016/06/23/fix-docker-networking-dns/

## Automatically starting container on host reboot
TBD

## Error handling
Errors the microservice encounters are published to ${topic}/exception.
