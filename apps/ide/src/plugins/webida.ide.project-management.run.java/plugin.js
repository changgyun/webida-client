/*
 * Copyright (c) 2012-2015 S-Core Co., Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

define([
    'external/lodash/lodash.min',
    'dijit/form/Select',
    'dijit/layout/ContentPane',
    'dijit/registry',
    'dojo/i18n!./nls/resource',
    'dojo/on',
    'dojo/topic',
    'webida-lib/app',
    'webida-lib/util/locale',
    'webida-lib/util/notify',
    'webida-lib/widgets/dialogs/file-selection/FileSelDlg2States', // FileDialog
    'text!./layout/java-run-configuration.html'
], function (
    _,
    Select,
    ContentPane,
    registry,
    i18n,
    on,
    topic,
    ide,
    Locale,
    notify,
    FileDialog,
    template
) {
    'use strict';

    var EVENT_TYPE_SAVE = 'save';
    var EVENT_TYPE_STATE = 'state';

    var PATTERN_MAIN_FILE = /^((?:[^\\/:\*\?"<>\|]*\/)*)([^\\/:\*\?"<>\|]*)\.java$/i;

    var FS = ide.getMount();
    var SRC_DIR = 'src';
    var TARGET_DIR = 'target';
    var currentRunConf;
    var ui = {};

    var locale = new Locale(i18n);

    function _checkInvalidField(runConf) {
        var runConfToCheck = runConf;
        if (!runConf) {
            var fullPath = ui.readonlyInputBoxes[0].value;
            var path;
            if (fullPath) {
                var matchResult = PATTERN_MAIN_FILE.exec(fullPath);
                if (matchResult === null) {
                    return i18n.validationInvalidPath;
                } else {
                    path = matchResult[1].split('/').join('.') + matchResult[2];
                }
            }
            runConfToCheck = {
                name: ui.inputBoxNodes[0].value,
                project: ui.select.get('value'),
                path: path,
                outputDir : TARGET_DIR,
                srcDir: SRC_DIR
            };
        }

        if (!runConfToCheck.name) {
            return i18n.validationNoName;
        }
        if (!runConfToCheck.path) {
            return i18n.validationNoPath;
        }

        currentRunConf = _.extend(currentRunConf, runConfToCheck);

        return;
    }

    function _pathButtonClicked() {
        var pathInputBox = ui.readonlyInputBoxes[0];
        var nameInputBox = ui.inputBoxNodes[0];
        var project = ui.select.get('value');
        var initialPath;
        var root;
        var dlg;

        if (!currentRunConf || !project || !pathInputBox) {
            notify.error(i18n.messageFailFindRoot);
            return;
        }

        root = ide.getPath() + '/' + project + '/' + SRC_DIR + '/';
        if (pathInputBox.value) {
            initialPath = root + pathInputBox.value;
        } else {
            initialPath = root;
        }

        dlg = new FileDialog({
            mount: ide.getFSCache(),
            root: root,
            initialSelection: [initialPath],
            title: i18n.titleSelectMain,
            singular: true,
            dirOnly: false,
            showRoot: false
        });
        dlg.open(function (selected) {
            var pathSplit;
            if (selected) {
                if (selected.length <= 0) {
                    notify.warning(i18n.validationNoJavaFile);
                    return;
                }
                pathSplit = selected[0].split(root);
                if (pathSplit.length > 0) {
                    pathInputBox.value = pathSplit[1];

                    if (nameInputBox && currentRunConf.__nameGen) {
                        // It is only called when the current run configuration is new and never get any user inputs
                        nameInputBox.value = pathInputBox.value;
                    }
                    var isValid = !_checkInvalidField();
                    topic.publish('project/run/config/changed', EVENT_TYPE_STATE, currentRunConf, {
                        isValid: isValid,
                        isDirty: true
                    });
                } else {
                    notify.warning(i18n.validationNoJavaFile);
                }
            }
        });
    }

    function _setTemplate() {
        var runConf = currentRunConf;
        ui.content.setContent(template);
        if (runConf) {
            var child = ui.content.domNode;
            ui.inputBoxNodes = $(child).find('.rcw-content-table-inputbox-edit');
            ui.inputBoxNodes[0].value = runConf.name ? runConf.name : '';
            ui.readonlyInputBoxes = $(child).find('.rcw-content-table-inputbox-readonly');
            ui.readonlyInputBoxes[0].value = runConf.path ? (runConf.path.split('.').join('/') + '.java') : '';

            ide.getWorkspaceInfo(function (err, workspaceInfo) {
                if (!err) {
                    var projects = workspaceInfo.projects.map(function (project) {
                        return {
                            value: project,
                            label: project
                        };
                    });
                    if (registry.byId('run-configuration-java-project')) {
                        registry.byId('run-configuration-java-project').destroy();
                    }
                    ui.select = new Select({ options: projects }, 'run-configuration-java-project');
                    ui.select.startup();
                    ui.select.set('value', runConf.project);
                }
            });

            ui.saveButton = registry.byId('rcw-action-save');
            ui.pathButton = $(child).find('.rcw-action-path').get(0);

            on(ui.content, 'input, select:change', function () {
                topic.publish('project/run/config/changed', EVENT_TYPE_STATE, currentRunConf, 
                              {isValid: !_checkInvalidField(), isDirty: true});
            });

            ui.content.own(
                on(ui.saveButton, 'click', function () {
                    var invalidMsg = _checkInvalidField();
                    if (!invalidMsg) {
                        topic.publish('project/run/config/changed', EVENT_TYPE_SAVE, currentRunConf);
                    } else {
                        notify.error(invalidMsg);
                    }
                }),
                on(ui.pathButton, 'click', _pathButtonClicked),
                on(ui.inputBoxNodes[0], 'change', function () {
                    currentRunConf.__nameGen = false;
                })
            );
        }
        locale.convertMessage(ui.content.domNode);
    }


    return {
        run: function (runConf, callback) {
            var rootPath = ide.getPath() + '/' + runConf.project;
            var filePath = runConf.srcDir + '/' + runConf.path.replace(/\./g, '/') + '.java';
            FS.exec(rootPath, {cmd: 'javac', args: ['-d', runConf.outputDir, filePath]},
                function (err, stdout, stderr) {
                    console.debug('###javac', runConf.path, stdout, stderr);
                    topic.publish('#REQUEST.log', stdout);
                    topic.publish('#REQUEST.log', stderr);
                    if (!err && !stderr) {
                        FS.exec(rootPath, {cmd: 'java', args: ['-cp', runConf.outputDir, runConf.path]},
                            function (err, stdout, stderr) {
                                console.debug('###java', runConf.path, stdout, stderr);
                                topic.publish('#REQUEST.log', stdout);
                                topic.publish('#REQUEST.log', stderr);
                                callback(null, runConf);
                            });
                    }
                });
        },
        newConf: function (content, runConf, callback) {
            currentRunConf = runConf;
            currentRunConf.__nameGen = true;
            ui.content = content;
            _setTemplate();
            topic.publish('project/run/config/changed', EVENT_TYPE_STATE, runConf, {
                isValid: !_checkInvalidField(runConf),
                isDirty: true
            });
            callback(null, runConf);
        },
        loadConf: function (content, runConf, callback) {
            currentRunConf = runConf;
            ui.content = content;
            _setTemplate();
            topic.publish('project/run/config/changed', EVENT_TYPE_STATE, runConf, {
                isValid: !_checkInvalidField(runConf)
            });
            callback(null, runConf);
        },
        saveConf: function (runConf, callback) {
            // validation
            var invalidMsg = _checkInvalidField();
            if (!invalidMsg) {
                topic.publish('project/run/config/changed', EVENT_TYPE_STATE, runConf, {
                    isDirty: false
                });
                callback(null, runConf);
            } else {
                callback(invalidMsg);
            }
            
        },
        deleteConf: function (runConfName, callback) {
            callback(null, currentRunConf);
        }
    };
});
