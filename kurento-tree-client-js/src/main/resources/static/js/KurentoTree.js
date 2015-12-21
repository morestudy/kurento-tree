//One participant KurentoTreeClient
function KurentoTree(wsUri) {

	var that = this;

	var ee = new EventEmitter();

	var jsonrpcClient;
	var connected = false;
	var source = false;

	var _treeId;
	var sinkId;

	var webRtcPeer;

	var treeResponseReady = false;
	var localIceCandidates = [];
	var remoteIceCandidates = [];

	this.addTreeSink = function(treeId, options) {

		_treeId = treeId;
		source = false;

		if (!options) {
			options = {}
		}

		options.onicecandidate = localOnIceCandidate;

		webRtcPeer = new kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(options,
				function(error) {
					if (error) {
						return console.error("Error creating WebRtcPeer: "
								+ JSON.stringify(error));
					}
					this.generateOffer(offerCallback);
				});
	}

	this.setTreeSource = function(treeId, options) {

		_treeId = treeId;
		source = true;

		jsonrpcClient.send("createTree", {
			treeId : treeId
		}, function(error, response) {
			if (error) {
				requestErrorHandler(error, "createTree");
			} else {

				if (!options) {
					options = {}
				}

				options.onicecandidate = localOnIceCandidate;

				webRtcPeer = new kurentoUtils.WebRtcPeer.WebRtcPeerSendonly(
						options, function(error) {
							if (error) {
								return console
										.error("Error creating WebRtcPeer: "
												+ JSON.stringify(error));
							}
							this.generateOffer(offerCallback);
						});
			}
		});
	}

	this.close = function() {

		if (treeId) {
			if (source) {
				jsonrpcClient.send("removeTreeSource", {
					treeId : _treeId
				});
			} else {
				jsonrpcClient.send("removeTreeSink", {
					treeId : _treeId,
					sinkId : sinkId
				});
			}
		}

		if (webRtcPeer) {
			webRtcPeer.dispose();
			webRtcPeer = null;
		}

		jsonrpcClient.close();
	}

	function offerCallback(error, offerSdp) {
		if (error) {
			return console.error("sdp offer error");
		}

		console.log('Invoking SDP offer callback function');

		var method = source ? "setTreeSource" : "addTreeSink";

		jsonrpcClient.send(method, {
			treeId : _treeId,
			offerSdp : offerSdp
		}, function(error, response) {
			if (error) {
				requestErrorHandler(error, method);
			} else {

				var sdp;
				if (source) {
					sdp = response.answerSdp;
				} else {
					sdp = response.answerSdp;
					sinkId = response.sinkId;
				}

				console.log("Registered sinkId = " + sinkId);

				webRtcPeer.processAnswer(sdp, function(error) {
					if (error)
						return console.error(error);
				});

				treeResponseReady = true;
				sendStoredCandidates();
			}
		});
	}

	function localOnIceCandidate(candidate) {

		console.log("localOnIceCandidate");

		if (!treeResponseReady) {
			console.log("Stored IceCandidate until response");
			localIceCandidates.push(candidate);
		} else {
			sendCandidate(candidate);
		}
	}

	function sendStoredCandidates() {

		console.log("Sending stored local IceCandidates");
		
		var i;
		for (i = 0; i < localIceCandidates.length; i++) {
			sendCandidate(localIceCandidates[i]);
		}

		localIceCandidates = [];
	}

	function sendCandidate(candidate) {

		// FIXME have to make a copy to another object.
		// see this bug
		// https://code.google.com/p/chromium/issues/detail?id=468180
		var copiedCandidate = {
			candidate : candidate.candidate,
			sdpMid : candidate.sdpMid,
			sdpMLineIndex : candidate.sdpMLineIndex,
			treeId : _treeId,
			sinkId : sinkId
		};

		jsonrpcClient.send('addIceCandidate', copiedCandidate, function(error,
				result) {
			if (error) {
				requestErrorHandler(error, "onIceCandidate");
			}
		});

	}

	function remoteOnIceCandidate(message) {

		var candidate = {
			candidate : message.candidate,
			sdpMid : message.sdpMid,
			sdpMLineIndex : message.sdpMLineIndex
		}

		webRtcPeer.addIceCandidate(candidate, function(error) {
			if (error) {
				console.error("Error adding candidate: "
						+ JSON.stringify(error));
				return;
			}
		});

	}

	function init() {

		var config = {
			heartbeat : 3000,
			sendCloseMessage : true,
			ws : {
				uri : wsUri,
				useSockJS : true,
				onconnected : connectCallback,
				ondisconnect : disconnectCallback,
				onreconnecting : disconnectCallback,
				onreconnected : connectCallback,
			},
			rpc : {
				requestTimeout : 15000,
				treeStopped : treeStopped,
				iceCandidate : remoteOnIceCandidate,
			}
		};

		jsonrpcClient = new RpcBuilder.clients.JsonRpcClient(config);
	}

	function connectCallback() {
		connected = true;
		ee.emitEvent('ws-connected', [ {} ]);
	}

	function disconnectCallback() {
		connected = false;
		ee.emitEvent('ws-disconnected', [ {} ]);
	}

	this.isConnected = function() {
		return connected;
	}

	function treeStopped() {
		console.log("Tree stopped");
	}

	function requestErrorHandler(error, label) {
		console.error("Error " + JSON.stringify(error)
				+ " processing request with label '" + label + "'.");
	}

	init();
}