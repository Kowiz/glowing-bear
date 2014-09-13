(function() {
'use strict';

var weechat = angular.module('weechat');

weechat.directive('inputBar', function() {

    return {

        templateUrl: 'directives/input.html',

        scope: {
            inputId: '@inputId',
            command: '=command'
        },

        controller: ['$rootScope', '$scope', '$element', '$log', 'connection', 'models', 'IrcUtils', function($rootScope,
                             $scope,
                             $element, //XXX do we need this? don't seem to be using it
                             $log,
                             connection, //XXX we should eliminate this dependency and use signals instead
                             models,
                             IrcUtils) {

            /*
             * Returns the input element
             */
            $scope.getInputNode = function() {
                return document.querySelector('textarea#' + $scope.inputId);
            };

            $scope.hideSidebar = function() {
                $rootScope.hideSidebar();
            };

            $scope.completeNick = function() {
                // input DOM node
                var inputNode = $scope.getInputNode();

                // get current caret position
                var caretPos = inputNode.selectionStart;

                // get current active buffer
                var activeBuffer = models.getActiveBuffer();

                // Empty input makes $scope.command undefined -- use empty string instead
                var input = $scope.command || '';

                // complete nick
                var nickComp = IrcUtils.completeNick(input, caretPos, $scope.iterCandidate,
                                                     activeBuffer.getNicklistByTime(), ':');

                // remember iteration candidate
                $scope.iterCandidate = nickComp.iterCandidate;

                // update current input
                $scope.command = nickComp.text;

                // update current caret position
                setTimeout(function() {
                    inputNode.focus();
                    inputNode.setSelectionRange(nickComp.caretPos, nickComp.caretPos);
                }, 0);
            };


            // Send the message to the websocket
            $scope.sendMessage = function() {
                //XXX Use a signal here
                var ab = models.getActiveBuffer();

                // It's undefined early in the lifecycle of the program.
                // Don't send empty commands
                if($scope.command !== undefined && $scope.command !== '') {

                    // log to buffer history
                    ab.addToHistory($scope.command);

                    // Split the command into multiple commands based on line breaks
                    _.each($scope.command.split(/\r?\n/), function(line) {
                        connection.sendMessage(line);
                    });

                    // Check for /clear command
                    if ($scope.command === '/buffer clear' || $scope.command === '/c') {
                        $log.debug('Clearing lines');
                        ab.clear();
                    }

                    // Empty the input after it's sent
                    $scope.command = '';
                }

                $scope.getInputNode().focus();
            };

            //XXX THIS DOES NOT BELONG HERE!
            $rootScope.addMention = function(prefix) {
                // Extract nick from bufferline prefix
                var nick = prefix[prefix.length - 1].text;

                var newValue = $scope.command || '';  // can be undefined, in that case, use the empty string
                var addColon = newValue.length === 0;
                if (newValue.length > 0) {
                    // Try to determine if it's a sequence of nicks
                    var trimmedValue = newValue.trim();
                    if (trimmedValue.charAt(trimmedValue.length - 1) === ':') {
                        // get last word
                        var lastSpace = trimmedValue.lastIndexOf(' ') + 1;
                        var lastWord = trimmedValue.slice(lastSpace, trimmedValue.length - 1);
                        var nicklist = models.getActiveBuffer().getNicklistByTime();
                        // check against nicklist to see if it's a list of highlights
                        for (var index in nicklist) {
                            if (nicklist[index].name === lastWord) {
                                // It's another highlight!
                                newValue = newValue.slice(0, newValue.lastIndexOf(':')) + ' ';
                                addColon = true;
                                break;
                            }
                        }
                    }

                    // Add a space before the nick if there isn't one already
                    // Last char might have changed above, so re-check
                    if (newValue.charAt(newValue.length - 1) !== ' ') {
                        newValue += ' ';
                    }
                }
                // Add highlight to nicklist
                newValue += nick;
                if (addColon) {
                    newValue += ': ';
                }
                $scope.command = newValue;
                $scope.getInputNode().focus();
            };


            // Handle key presses in the input bar
            $rootScope.handleKeyPress = function($event) {
                // don't do anything if not connected
                if (!$rootScope.connected) {
                    return true;
                }

                var inputNode = $scope.getInputNode();

                // Support different browser quirks
                var code = $event.keyCode ? $event.keyCode : $event.charCode;
                var keydown = $event.type === "keydown";

                // any other key than Tab resets nick completion iteration
                var tmpIterCandidate = $scope.iterCandidate;
                $scope.iterCandidate = null;

                // Left Alt+[0-9] -> jump to buffer
                if ($event.altKey && !$event.ctrlKey && (code > 47 && code < 58)) {
                    if (code === 48) {
                        code = 58;
                    }

                    var bufferNumber = code - 48 - 1 ;
                    // Map the buffers to only their numbers and IDs so we don't have to
                    // copy the entire (possibly very large) buffer object, and then sort
                    // the buffers according to their WeeChat number
                    var sortedBuffers = _.map(models.getBuffers(), function(buffer) {
                        return [buffer.number, buffer.id];
                    }).sort(function(left, right) {
                        // By default, Array.prototype.sort() sorts alphabetically.
                        // Pass an ordering function to sort by first element.
                        return left[0] - right[0];
                    });
                    var activeBufferId = sortedBuffers[bufferNumber];
                    if (activeBufferId) {
                        $scope.$parent.setActiveBuffer(activeBufferId[1]);
                        $event.preventDefault();
                    }
                }

                // Tab -> nick completion
                if (code === 9 && !$event.altKey && !$event.ctrlKey) {
                    $event.preventDefault();
                    $scope.iterCandidate = tmpIterCandidate;
                    $scope.completeNick();
                    return true;
                }

                // Left Alt+n -> toggle nicklist
                if ($event.altKey && !$event.ctrlKey && code === 78) {
                    $event.preventDefault();
                    $rootScope.toggleNicklist();
                    return true;
                }

                // Alt+A -> switch to buffer with activity
                if ($event.altKey && (code === 97 || code === 65)) {
                    $event.preventDefault();
                    models.switchToActivityBuffer();
                    return true;
                }

                // Alt+L -> focus on input bar
                if ($event.altKey && (code === 76 || code === 108)) {
                    $event.preventDefault();
                    inputNode.focus();
                    inputNode.setSelectionRange($scope.command.length, $scope.command.length);
                    return true;
                }

                // Alt+< -> go back in history
                if ($event.altKey && (code === 60 || code === 226)) {
                    $event.preventDefault();
                    return models.switchToPrevNextBuffer(false);
                }

                // Alt+> -> go forward in history
                // TODO alternative codes for cross-browser stuff
                if ($event.altKey && code === 62) {
                    $event.preventDefault();
                    return models.switchToPrevNextBuffer(true);
                }

                // Alt+/ -> switch to previous buffer
                if ($event.altKey && code === 47) {
                    $event.preventDefault();
                    return models.switchToLastBuffer();
                }

                // Double-tap Escape -> disconnect
                if (code === 27) {
                    $event.preventDefault();

                    // Check if a modal is visible. If so, close it instead of disconnecting
                    var modals = document.querySelectorAll('.gb-modal');
                    for (var modalId = 0; modalId < modals.length; modalId++) {
                        if (modals[modalId].getAttribute('data-state') === 'visible') {
                            modals[modalId].setAttribute('data-state', 'hidden');
                            return true;
                        }
                    }

                    if (typeof $scope.lastEscape !== "undefined" && (Date.now() - $scope.lastEscape) <= 500) {
                        // Double-tap
                        connection.disconnect();
                    }
                    $scope.lastEscape = Date.now();
                    return true;
                }

                // Alt+G -> focus on buffer filter input
                if ($event.altKey && (code === 103 || code === 71)) {
                    $event.preventDefault();
                    if (!$scope.$parent.isSidebarVisible()) {
                        $scope.$parent.showSidebar();
                    }
                    setTimeout(function() {
                        document.getElementById('bufferFilter').focus();
                    });
                    return true;
                }

                var caretPos;

                // Arrow up -> go up in history
                if (keydown && code === 38 && document.activeElement === inputNode) {
                    caretPos = inputNode.selectionStart;
                    if ($scope.command.slice(0, caretPos).indexOf("\n") !== -1) {
                        return false;
                    }
                    $scope.command = models.getActiveBuffer().getHistoryUp($scope.command);
                    // Set cursor to last position. Need 0ms timeout because browser sets cursor
                    // position to the beginning after this key handler returns.
                    setTimeout(function() {
                        if ($scope.command) {
                            inputNode.setSelectionRange($scope.command.length, $scope.command.length);
                        }
                    }, 0);
                    return true;
                }

                // Arrow down -> go down in history
                if (keydown && code === 40 && document.activeElement === inputNode) {
                    caretPos = inputNode.selectionStart;
                    if ($scope.command.slice(caretPos).indexOf("\n") !== -1) {
                        return false;
                    }
                    $scope.command = models.getActiveBuffer().getHistoryDown($scope.command);
                    // We don't need to set the cursor to the rightmost position here, the browser does that for us
                    return true;
                }

                // Enter to submit, shift-enter for newline
                if (code == 13 && !$event.shiftKey && document.activeElement === inputNode) {
                    $event.preventDefault();
                    $scope.sendMessage();
                    return true;
                }

                var bufferlines = document.getElementById("bufferlines");
                var lines;
                var i;

                // Page up -> scroll up
                if ($event.type === "keydown" && code === 33 && document.activeElement === inputNode && !$event.ctrlKey && !$event.altKey && !$event.shiftKey) {
                    lines = bufferlines.querySelectorAll("tr");
                    for (i = lines.length - 1; i >= 0; i--) {
                        if ((lines[i].offsetTop-bufferlines.scrollTop)<bufferlines.clientHeight/2) {
                            lines[i].scrollIntoView(false);
                            break;
                        }
                    }
                    return true;
                }

                // Page down -> scroll down
                if ($event.type === "keydown" && code === 34 && document.activeElement === inputNode && !$event.ctrlKey && !$event.altKey && !$event.shiftKey) {
                    lines = bufferlines.querySelectorAll("tr");
                    for (i = 0; i < lines.length; i++) {
                        if ((lines[i].offsetTop-bufferlines.scrollTop)>bufferlines.clientHeight/2) {
                            lines[i].scrollIntoView(true);
                            break;
                        }
                    }
                    return true;
                }

                // Some readline keybindings
                if ($rootScope.readlineBindings && $event.ctrlKey && !$event.altKey && !$event.shiftKey && document.activeElement === inputNode) {
                    // get current caret position
                    caretPos = inputNode.selectionStart;
                    // Ctrl-a
                    if (code == 65) {
                        inputNode.setSelectionRange(0, 0);
                    // Ctrl-e
                    } else if (code == 69) {
                        inputNode.setSelectionRange($scope.command.length, $scope.command.length);
                    // Ctrl-u
                    } else if (code == 85) {
                        $scope.command = $scope.command.slice(caretPos);
                        setTimeout(function() {
                            inputNode.setSelectionRange(0, 0);
                        });
                    // Ctrl-k
                    } else if (code == 75) {
                        $scope.command = $scope.command.slice(0, caretPos);
                        setTimeout(function() {
                            inputNode.setSelectionRange($scope.command.length, $scope.command.length);
                        });
                    // Ctrl-w
                    } else if (code == 87) {
                        var trimmedValue = $scope.command.slice(0, caretPos);
                        var lastSpace = trimmedValue.lastIndexOf(' ') + 1;
                        $scope.command = $scope.command.slice(0, lastSpace) + $scope.command.slice(caretPos, $scope.command.length);
                        setTimeout(function() {
                            inputNode.setSelectionRange(lastSpace, lastSpace);
                        });
                    } else {
                        return false;
                    }
                    $event.preventDefault();
                    return true;
                }
            };
        }]
    };
});
})();
