// Copyright (c) Microsoft. All rights reserved. Licensed under the MIT license.
// See full license at the bottom of this file.



// The initialize function is required for all add-ins.
Office.initialize = function () {
  jQuery(document).ready(function() {
    console.log('JQuery initialized');
  });
};

console.log('loading supply-chain add-in');

// TODO move to configuration retrieved from the server
const containerName = "attachments";

const beginProofString = "-----BEGIN PROOF-----";
const endProofString = "-----END PROOF-----";


function httpRequest(opts, cb) {
  console.log('calling', opts.method, opts.url, opts.data ? JSON.stringify(opts.data) : '');

  opts.success = function (data, textStatus) {
    console.log('got data:', data, textStatus);
    return cb(null, data);
  }
  
  opts.error = function (xhr, textStatus, errorThrown) {
    console.log('got error:', textStatus, errorThrown);
    return cb(new Error('error invoking http request:' + textStatus));
  }

  return $.ajax(opts);
}

function putProof(proof, cb) {
  console.log('adding proof:', proof);  
  return getUserIdentityToken(function(err, token) {
    if (err) return cb(err);

    return httpRequest({ 
      method: 'PUT', 
      contentType: "application/json; charset=utf-8",      
      url: '/api/proof',
      data: JSON.stringify(proof), 
      dataType: 'json',
      headers: { 'User-Token': token } 
    }, cb);
  });
}

function getKey(keyId, cb) {
  console.log('getting key for keyId', keyId);  
  return getUserIdentityToken(function(err, token) {
    if (err) return cb(err);

    if (keyId === decodeURIComponent(keyId)) {
      keyId = encodeURIComponent(keyId);
    }

    return httpRequest({ 
      method: 'GET', 
      url: '/api/key/' + keyId, 
      headers: { 'User-Token': token } 
    }, cb);
  });
}

function getProof(trackingId, cb) {
  console.log('getting proof for trackingId', trackingId);  
  return getUserIdentityToken(function(err, token) {
    if (err) return cb(err);

    if (trackingId === decodeURIComponent(trackingId)) {
      trackingId = encodeURIComponent(trackingId);
    }

    return httpRequest({ 
      method: 'GET', 
      url: '/api/proof/' + trackingId, 
      headers: { 'User-Token': token } 
    }, cb);
  });
}

function getHash(url, cb) {
  console.log('getting hash for url', url);
  return getUserIdentityToken(function(err, token) {
    if (err) return cb(err);

    return httpRequest({ 
      method: 'GET', 
      url: '/api/hash?url=' + encodeURIComponent(url), 
      headers: { 'User-Token': token } 
    }, cb);
  });
}

function getUserIdentityToken(cb) {
  return Office.context.mailbox.getUserIdentityTokenAsync(function(userToken) {
    if (userToken.error) return cb(userToken.error);
    return cb(null, userToken.value);
  });
}

function getClientConfiguration(cb) {
  console.log('getting configuration from server');
  return httpRequest({ method: 'GET', url: '/api/config' }, cb);
}

function storeAttachments(event) {
  console.log('storeAttachments called');
  return processAttachments(true, function(err, response) {
    if (err) return showMessage("Error: " + err.message, event);           
    console.log('got response', response);
  
    var trackingIds = [];
    if (response.attachmentProcessingDetails) {
      for (i = 0; i < response.attachmentProcessingDetails.length; i++ ) {

        var ad = response.attachmentProcessingDetails[i];
        var proof = {
          proofToEncrypt : {
            url : ad.url,
            sasToken : ad.sasToken,
            documentName : ad.name
          },
          publicProof : {
            documentHash : ad.hash
          }
        }; 
  
        return putProof(proof, function(err, response) {
          if (err) return showMessage(err.message, event);
          
          trackingIds.push(response.trackingId);
  
          Office.context.mailbox.item.displayReplyForm(JSON.stringify(trackingIds));
          return showMessage("Attachments processed: " + JSON.stringify(trackingIds), event);
        });
      }
    }
  });
}

function processAttachments(isUpload, cb) {

  console.log('processing attachments, isUpload:', isUpload);

  if (!Office.context.mailbox.item.attachments) {
    return cb(new Error("Not supported: Attachments are not supported by your Exchange server."));
  }

  if (!Office.context.mailbox.item.attachments.length) {
    return cb(new Error("No attachments: There are no attachments on this item."));
  }

  return Office.context.mailbox.getCallbackTokenAsync(function(attachmentTokenResult) {
    console.log('getCallbackTokenAsync callback result:', attachmentTokenResult);    
    if (attachmentTokenResult.error) return cb(attachmentTokenResult.error);

    return getClientConfiguration(function(err, config) {
      if (err) return cb(err);

      var data = {};
      data.ewsUrl = Office.context.mailbox.ewsUrl;
      data.attachments = [];
      data.containerName = containerName;
      data.upload = isUpload;
      data.attachmentToken = attachmentTokenResult.value;

      // extract attachment details 
      for (i = 0; i < Office.context.mailbox.item.attachments.length; i++) {
        var attachment = Office.context.mailbox.item.attachments[i];
        attachment = attachment._data$p$0 || attachment.$0_0;

        if (attachment) {
          // I copied this line from the msdn example - not sure why first stringify and then parse the attachment
          // TODO: check this. probably the origin intention was to create a new object. but I don't see why we need this.
          data.attachments[i] = JSON.parse(JSON.stringify(attachment));
        }
      }

      return getUserIdentityToken(function(err, token) {
        if (err) return cb(err);


        // **************************************************************************************************
        // TODO: remove, this is a temporary bypassing the document service until Beat brings it online
        /*
        return cb(null, {
          attachmentProcessingDetails: [
            {
              url: 'http://...',
              sasToken: 'some token',
              name: 'some name',
              hash: 'the hash!'
            }
          ]
        });
        */
        // **************************************************************************************************


        return httpRequest({
          url: config.documentServiceUrl + "/api/Attachment",
          type: 'POST',
          contentType: "application/json; charset=utf-8",          
          data: data,          
          dataType: 'json',
          headers: { 'User-Token': token },
        }, function(err, response){
            if (err) return cb(err);
          
            // in this case the document service might return a result that contains an error, so also need to check this specifically
            // TODO: revisit api on document service after rewriting in Node.js.
            // if there's an error it should send back a statusCode != 200 to indicate that
            if (response.isError) return cb(new Error('error uploading document: ' + response.message));
  
            return cb(null, response);
        });

      });
    });
  });
}

function getFirstAttachmentHash(cb) {

  return processAttachments(true, function(err, response) {
    if (err) return cb(err);
    console.log('got response', response);    

    if (!response.attachmentProcessingDetails || !response.attachmentProcessingDetails.length) {
      console.error('hash is not available');
      return cb(new Error('hash not available'));
    }

    var hash = response.attachmentProcessingDetails[0].hash;
    return cb(null, { hash: hash });

  });
}


// TODO: revisit&rewrite this function
function validateProof(event) {
  return Office.context.mailbox.item.body.getAsync('text', {}, function(result) {
    if (result.status === Office.AsyncResultStatus.Failed) {
      return showMessage(result.error, event);
    }
    
    try {
      var body = result.value;
      if (body.search(beginProofString) === -1 || body.search(endProofString) === -1) {
        return showMessage("No proofs to validate found in email", event);           
      }

      var proofs = body.split(beginProofString);

      for (var i in proofs) {
        if (proofs[i].search(endProofString) != -1) {
          var proof = proofs[i].split(endProofString);

          if (!proof.length) {
            return showMessage("Unable to validate proof(s)", event); 
          }

          var jsonProof = JSON.parse(proof[0]);
          return getProof(jsonProof[0].trackingId, function(err, result) {
            console.log('get proof from chain:', err, result);
            if (err) {
              return showMessage("error retrieving the proof from blockchain for validation - trackingId: " + jsonProof[0].trackingId + " error: " + err.message, event); 
            }
            
            if (!result) {
              return showMessage("error retrieving the proof from blockchain for validation - trackingId: " + jsonProof[0].trackingId, event); 
            }

            var proofFromChain = result.result[0];
            var proofToEncryptStr = JSON.stringify(jsonProof[0].encryptedProof);
            var hash = sha256(proofToEncryptStr);

            if (proofFromChain.publicProof.encryptedProofHash !== hash.toUpperCase()) {
              return showMessage("NOT valid proof for trackingId: " + jsonProof[0].trackingId, event);                                   
            }

            if (!proofFromChain.publicProof.publicProof || !proofFromChain.publicProof.publicProof.documentHash) {
              return showMessage("Valid proof with NO attachment for trackingId: " + jsonProof[0].trackingId, event);                                             
            }

            return getFirstAttachmentHash(function(err, result) {
              console.log('retrieving first attachment hash:', err, result);
              if (err) {
                return showMessage("error retrieving first attachment hash - trackingId: " + jsonProof[0].trackingId + " error: " + err.message, event); 
              }

              var hash = result.hash;
              if (proofFromChain.publicProof.publicProof.documentHash === hash) {
                return showMessage("Valid proof with attachment for trackingId: " + jsonProof[0].trackingId, event);
              } 

              return showMessage("Valid proof BUT attachment NOT valid for trackingId: " + jsonProof[0].trackingId, event);
              
            });
          });
        }
      }
    }
    catch(ex) {
      return showMessage(ex.message, event);       
    }
  });
}

function provideProof(event) {
  return Office.context.mailbox.item.body.getAsync('text', {}, function(result) {
    if (result.status === Office.AsyncResultStatus.Failed) {
      return showMessage(result.error, event);
    }

    var body = result.value;
    var trackingId = body.trim();
    console.log('providing proof for trackingId:', trackingId);

    return getProof(trackingId, function(err, response) {
      if (err) {
        console.error('error getting proof:', err.message);
        return showMessage(err.message, event);
      }
      
      var proofs = response.result;
      console.log('got proofs:', proofs);

      var attachments = [];
      for (var i in proofs) {
        var proof = proofs[i];
        if (proof && proof.encryptedProof && proof.encryptedProof.sasToken && proof.encryptedProof.documentName) {
          attachments.push({
            type : Office.MailboxEnums.AttachmentType.File,
            url : proof.encryptedProof.sasToken, 
            name : proof.encryptedProof.documentName
          })
        }
      }

      console.log('attachments: ', attachments);

      var replyText = "Please find below the requested proofs for your own validation.\r\f\r\f\r\f"+ beginProofString + JSON.stringify(proofs, null, 2) + endProofString;
      
      var opts = {
        'htmlBody' : replyText,
        'attachments' : attachments
      };

      console.log('creating a reply mail with ', JSON.stringify(opts, true, 2));
      Office.context.mailbox.item.displayReplyForm(opts);
      
      showMessage("Proof have been added for: " + trackingId, event);
    });
  });
}

function showMessage(message, event) {
	Office.context.mailbox.item.notificationMessages.replaceAsync('ibera-notifications-id', {
		type: Office.MailboxEnums.ItemNotificationMessageType.InformationalMessage,
		icon: 'icon-16',
		message: message,
		persistent: false
	}, function (result) {
    if (result.status === Office.AsyncResultStatus.Failed) {
      showMessage('Error showing a notification', event);
    }
    if (event) {
      event.completed();
    }
  });
}


/*
  MIT License:

  Permission is hereby granted, free of charge, to any person obtaining
  a copy of this software and associated documentation files (the
  'Software'), to deal in the Software without restriction, including
  without limitation the rights to use, copy, modify, merge, publish,
  distribute, sublicense, and/or sell copies of the Software, and to
  permit persons to whom the Software is furnished to do so, subject to
  the following conditions:

  The above copyright notice and this permission notice shall be
  included in all copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
  NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
  LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
  OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
  WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
