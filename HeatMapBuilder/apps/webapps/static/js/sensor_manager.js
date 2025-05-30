export class SensorManager {
    constructor(svgElement, uiManager) {
        // 상수 정의
        this.MARKER_RADIUS = 5;
        this.MARKER_FILL = 'red';
        this.TEXT_FILL = 'black';
        this.TEXT_SIZE = '12';
        this.RECT_FILL = 'white';
        this.RECT_OPACITY = '0.8';
        this.RECT_RADIUS = '3';

        // 속성 초기화
        this.svg = svgElement;
        this.sensors = [];
        this.filteredSensors = [];
        this.addedSensors = new Set();  // 추가된 센서 ID 목록
        this.onSensorsUpdate = null;
        this.enabled = true;
        this.currentUnit = null;
        this.filters = {
            device_class: '',
            label: '',
            search: ''
        };
        this.uiManager = uiManager;
        this.mapId = new URLSearchParams(window.location.search).get('id');
        this.debounceTimer = null;  // 디바운스 타이머 추가

        // SVG viewBox 파싱
        const viewBox = this.svg.getAttribute('viewBox');
        if (viewBox) {
            const [minX, minY, width, height] = viewBox.split(' ').map(Number);
            this.viewBox = { minX, minY, width, height };
        } else {
            this.viewBox = { minX: 0, minY: 0, width: this.svg.clientWidth, height: this.svg.clientHeight };
        }

        // 이벤트 핸들러 바인딩
        this.handleDragStart = this.handleDragStart.bind(this);
        this.handleDragOver = this.handleDragOver.bind(this);
        this.handleDrop = this.handleDrop.bind(this);
        this.handleCheckboxChange = this.handleCheckboxChange.bind(this);

        // SVG 이벤트 리스너 등록
        this.svg.addEventListener('dragover', this.handleDragOver);
        this.svg.addEventListener('drop', this.handleDrop);

        this.initialize();
    }

    async initialize() {
        if (!this.mapId) {
            this.uiManager.showMessage('맵 ID가 없습니다.', 'error');
            return;
        }
    }

    // 설정 및 상태 관리
    enable() {
        this.enabled = true;
        this.updateSensorList();
    }

    disable() {
        this.enabled = false;
        this.updateSensorList();
    }

    // 필터 설정 업데이트
    updateFilters(newFilters) {
        // 이전 타이머가 있다면 취소
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        // 새로운 필터 값을 임시 저장
        const updatedFilters = { ...this.filters, ...newFilters };

        // 0.5초 후에 필터 적용
        this.debounceTimer = setTimeout(() => {
            this.filters = updatedFilters;
            this.applyFilters();
            this.updateSensorList();
            this.debounceTimer = null;
        }, 300);
    }

    // 필터 적용 메서드
    applyFilters() {
        this.filteredSensors = this.sensors.filter(sensor => {
            const matchDeviceClass = !this.filters.device_class ||
                sensor.attributes.device_class === this.filters.device_class;
            const matchLabel = !this.filters.label ||
                (sensor.labels && sensor.labels.includes(this.filters.label));
            const matchSearch = !this.filters.search ||
                sensor.attributes.friendly_name?.toLowerCase().includes(this.filters.search.toLowerCase()) ||
                sensor.entity_id.toLowerCase().includes(this.filters.search.toLowerCase());

            return matchDeviceClass && matchLabel && matchSearch;
        });
        this.updateSensorList();
    }

    // 데이터 로딩 및 에러 처리
    async loadLabelRegistry() {
        const response = await fetch('./api/get_label_registry');
        const labelRegistry = await response.json();

        // 레이블 필터 select 엘리먼트를 div로 대체
        const labelFilterContainer = document.getElementById('filter-label-container');
        if (labelFilterContainer) {
            // 기존 custom-select 제거
            const existingCustomSelect = labelFilterContainer.querySelector('.custom-select');
            if (existingCustomSelect) {
                existingCustomSelect.remove();
            }

            // 커스텀 드롭다운 생성
            const customSelect = document.createElement('div');
            customSelect.className = 'custom-select relative';
            
            // 선택된 값을 보여주는 버튼
            const selectedButton = document.createElement('button');
            selectedButton.className = 'selected-option w-full px-2 py-1.5 text-left border rounded-md bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs';
            selectedButton.innerHTML = '<span>모든 레이블</span>';
            
            // 옵션 리스트 컨테이너
            const optionsList = document.createElement('div');
            optionsList.className = 'options-list absolute w-full mt-1 bg-white border rounded-md shadow-lg hidden z-50';
            
            // 기본 옵션 추가
            const defaultOption = document.createElement('div');
            defaultOption.className = 'option px-2 py-1.5 hover:bg-gray-100 cursor-pointer text-xs';
            defaultOption.innerHTML = '<span>모든 레이블</span>';
            defaultOption.dataset.value = '';
            optionsList.appendChild(defaultOption);

            // 레이블 옵션 추가
            labelRegistry.forEach(label => {
                const option = document.createElement('div');
                option.className = 'option px-2 py-1.5 hover:bg-gray-100 cursor-pointer flex items-center text-xs';
                option.innerHTML = `
                    <i class="mdi ${label.icon.replace('mdi:', 'mdi-')} mr-2"></i>
                    <span>${label.name}</span>
                `;
                option.dataset.value = label.label_id;
                optionsList.appendChild(option);
            });

            // 이벤트 리스너 추가
            selectedButton.addEventListener('click', (e) => {
                e.stopPropagation();
                optionsList.classList.toggle('hidden');
            });

            // 옵션 선택 이벤트
            optionsList.querySelectorAll('.option').forEach(option => {
                option.addEventListener('click', (e) => {
                    const value = (/** @type {HTMLElement} */ (option)).dataset.value;
                    selectedButton.innerHTML = option.innerHTML;
                    optionsList.classList.add('hidden');
                    this.updateFilters({ label: value });
                });
            });

            // 외부 클릭 시 드롭다운 닫기
            document.addEventListener('click', () => {
                optionsList.classList.add('hidden');
            });

            customSelect.appendChild(selectedButton);
            customSelect.appendChild(optionsList);
            labelFilterContainer.appendChild(customSelect);
        }
    }

    // 센서 데이터 로드
    async loadSensors() {
        try {
            // 레이블 레지스트리 로드
            await this.loadLabelRegistry();

            // 센서 상태 로드
            const response = await fetch('./api/states');
            const states = await response.json();

            this.sensors = states;
            this.applyFilters();

            // 저장된 설정 로드
            const configResponse = await fetch(`./api/load-config/${this.mapId}`);
            if (configResponse.ok) {
                const config = await configResponse.json();
                // 저장된 단위 정보 적용
                if (config.unit) {
                    this.currentUnit = config.unit;
                }

                // 저장된 센서 위치 정보를 현재 센서 데이터에 적용
                if (config.sensors) {
                    this.applySavedSensorConfig(config.sensors);
                }
            }

            this.updateSensorList();
        } catch (error) {
            this.uiManager.showMessage('센서를 불러오는데 실패했습니다.', 'error');
        }
    }

    applySavedSensorConfig(savedSensors) {
        savedSensors.forEach(savedSensor => {
            const sensor = this.sensors.find(s => s.entity_id === savedSensor.entity_id);
            if (sensor && savedSensor.position) {
                // 단위 체크
                if (this.checkAndHandleUnit(sensor)) {
                    sensor.position = savedSensor.position;
                    sensor.calibration = savedSensor.calibration || 0;
                    this.addedSensors.add(sensor.entity_id);  // 저장된 센서 추가 기록
                    this.updateSensorMarker(sensor, savedSensor.position);
                }
            }
        });
    }

    displayError(message) {
        const container = document.getElementById('sensor-container');
        if (container) {
            container.innerHTML = `
                <div class="p-4 bg-red-50 border border-red-200 rounded-md">
                    <p class="text-red-600">${message}</p>
                    <button id="retry-load-sensors" class="mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-700">다시 로드</button>
                </div>
            `;
            document.getElementById('retry-load-sensors').addEventListener('click', this.loadSensors.bind(this));
        }
    }

    // UI 업데이트
    updateSensorList() {
        const container = document.getElementById('sensor-container');
        if (!container) return;

        if (!this.filteredSensors || this.filteredSensors.length === 0) {
            container.innerHTML = `
                <div class="p-4 bg-yellow-50 border border-yellow-200 rounded-md">
                    <p class="text-yellow-600">사용 가능한 센서가 없습니다.</p>
                </div>
            `;
            return;
        }

        // 센서를 이미 추가된 것, 현재 단위와 일치하는 것, 나머지 순으로 정렬
        const sortedSensors = [...this.filteredSensors].sort((a, b) => {
            const isAddedA = this.addedSensors.has(a.entity_id);
            const isAddedB = this.addedSensors.has(b.entity_id);
            const matchesUnitA = this.currentUnit && a.attributes?.unit_of_measurement === this.currentUnit;
            const matchesUnitB = this.currentUnit && b.attributes?.unit_of_measurement === this.currentUnit;

            // 둘 다 추가된 경우 이름순
            if (isAddedA && isAddedB) {
                return (a.attributes.friendly_name || a.entity_id).localeCompare(b.attributes.friendly_name || b.entity_id);
            }
            // 하나만 추가된 경우 추가된 것이 우선
            if (isAddedA || isAddedB) {
                return isAddedA ? -1 : 1;
            }
            // 둘 다 추가되지 않은 경우, 단위 일치 여부로 정렬
            if (matchesUnitA !== matchesUnitB) {
                return matchesUnitA ? -1 : 1;
            }
            // 그 외의 경우 이름순
            return (a.attributes.friendly_name || a.entity_id).localeCompare(b.attributes.friendly_name || b.entity_id);
        });

        container.innerHTML = sortedSensors.map(sensor => this.createSensorListItem(sensor)).join('');

        // 필터 이벤트 리스너 설정
        const deviceClassFilter = /** @type {HTMLSelectElement} */ (document.getElementById('filter-device-class'));
        const labelFilter = /** @type {HTMLInputElement} */ (document.getElementById('filter-label'));
        const searchFilter = /** @type {HTMLInputElement} */ (document.getElementById('filter-sensor-name'));

        if (deviceClassFilter) {
            deviceClassFilter.value = this.filters.device_class;
            deviceClassFilter.addEventListener('change', (e) => {
                this.updateFilters({ device_class: /** @type {HTMLSelectElement} */ (e.target).value });
            });
        }

        if (labelFilter) {
            labelFilter.value = this.filters.label;
            labelFilter.addEventListener('input', (e) => {
                this.updateFilters({ label: /** @type {HTMLInputElement} */ (e.target).value });
            });
        }

        if (searchFilter) {
            searchFilter.value = this.filters.search;
            searchFilter.addEventListener('input', (e) => {
                this.updateFilters({ search: /** @type {HTMLInputElement} */ (e.target).value });
            });
        }

        // 체크박스 이벤트 설정
        if (this.enabled) {
            container.querySelectorAll('.sensor-checkbox').forEach(checkbox => {
                checkbox.addEventListener('change', this.handleCheckboxChange);
            });

            // 보정값 입력 이벤트 설정
            container.querySelectorAll('.calibration-input').forEach(input => {
                input.addEventListener('change', (e) => this.handleCalibrationChange(e));
                input.addEventListener('click', (e) => e.stopPropagation());
            });
        }
    }

    createSensorListItem(sensor) {
        const isPlaced = this.addedSensors.has(sensor.entity_id);
        const isValidState = !isNaN(parseFloat(sensor.state));  // state가 숫자인지 확인
        const hasUnit = !!sensor.attributes?.unit_of_measurement;  // unit_of_measurement가 있는지 확인
        const isValid = isValidState && hasUnit;  // 둘 다 만족해야 유효
        
        const itemClass = `sensor-item px-2 py-1 bg-white border-y border-gray-200 flex justify-between items-center ${!isValid ? 'opacity-50' : ''}`;
        const calibration = sensor.calibration || 0;
        const calibratedTemp = isValidState ? parseFloat(sensor.state) + calibration : NaN;
        const entityId = sensor.entity_id;
        const friendlyName = sensor.attributes.friendly_name || entityId;
        const unit = sensor.attributes.unit_of_measurement ?? '';
        const state = sensor.state;

        // 비활성화 이유 메시지
        let disabledReason = '';
        if (!isValidState) {
            disabledReason = '숫자가 아닌 값';
        } else if (!hasUnit) {
            disabledReason = '단위 정보 없음';
        }

        return `
            <div class="${itemClass}" data-entity-id="${entityId}">
                <div class="flex-1 px-2">
                     <div class="flex items-center">
                        <input type="checkbox"
                            class="sensor-checkbox mr-2"
                            data-entity-id="${entityId}"
                            ${isPlaced ? 'checked' : ''}
                            ${!isValid ? 'disabled' : ''}
                            style="pointer-events: auto;"
                        >
                        <span class="text-sm ${!isValid ? 'text-gray-400' : ''}">${friendlyName}</span>
                    </div>
                    <div class="grid grid-cols-3 gap-4 mt-1">
                        <span class="text-xs ${isValid ? 'text-gray-600' : 'text-red-400'}">
                            측정값: ${state} ${unit}
                            ${!isValid ? `<br><span class="text-xs text-red-400">(${disabledReason})</span>` : ''}
                        </span>
                        <span class="text-xs text-blue-600 ${!isValid ? 'opacity-50' : ''}">보정: 
                            <input type="number" 
                                class="calibration-input text-xs w-16 px-1 py-0.5 border border-gray-300 rounded"
                                value="${calibration}"
                                step="0.1"
                                data-entity-id="${entityId}"
                                ${!isValid ? 'disabled' : ''}
                                style="pointer-events: auto;"
                            >
                        </span>
                        <span class="text-xs ${isValid ? 'text-green-600' : 'text-gray-400'}">
                            보정후: ${isValid ? calibratedTemp.toFixed(1) : 'N/A'} ${unit}
                        </span>
                    </div>
                </div>
            </div>
        `;
    }

    // 이벤트 핸들러
    handleCalibrationChange(e) {
        const entityId = e.target.dataset.entityId;
        const calibration = parseFloat(e.target.value) || 0;
        const sensor = this.sensors.find(s => s.entity_id === entityId);
        if (sensor) {
            sensor.calibration = calibration;
            // 센서 마커 업데이트
            if (sensor.position) {
                this.updateSensorMarker(sensor, sensor.position);
            }
            this.updateSensorList();
        }
    }

    // 센서 추가 전 단위 체크
    checkAndHandleUnit(sensor) {
        const sensorUnit = sensor.attributes?.unit_of_measurement;
        
        // 단위 정보가 없는 경우
        if (!sensorUnit) {
            alert(`단위 정보가 없는 센서는 배치할 수 없습니다: ${sensor.attributes.friendly_name || sensor.entity_id}`);
            return false;
        }
        
        // 첫 센서인 경우
        if (!this.currentUnit) {
            this.currentUnit = sensorUnit;
            return true;
        }

        // 단위가 다른 경우
        if (this.currentUnit !== sensorUnit) {
            alert(`현재 맵에는 ${this.currentUnit} 단위의 센서만 배치할 수 있습니다. 다른 단위(${sensorUnit})의 센서를 배치하려면 먼저 기존 센서들을 모두 제거해야 합니다.`);
            return false;
        }

        return true;
    }

    // 모든 센서 추가
    addAllSensors() {
        const unit = this.filteredSensors[0]?.attributes.unit_of_measurement;
        if (!unit) {
            this.uiManager.showMessage('첫번째 센서의 단위 정보가 없습니다.', 'error');
            return;
        }
        
        this.currentUnit = unit;  // currentUnit 설정
        
        // 추가된 센서 목록을 저장하고, 나중에 한 번에 저장
        const newlyAddedSensors = [];
        
        this.filteredSensors.forEach(sensor => {
            if (sensor.attributes.unit_of_measurement !== unit) {
                this.uiManager.showMessage(`${sensor.attributes.friendly_name}의 단위가 ${unit}이 아닙니다.`, 'error');
                return;
            }
            if (!sensor.position) {
                sensor.position = this.getRandomCenterPoint();
                this.addedSensors.add(sensor.entity_id);
                this.updateSensorMarker(sensor, sensor.position);
                newlyAddedSensors.push(sensor);
            }
        });
        
        // 모든 센서가 추가된 후 한 번에 저장
        if (newlyAddedSensors.length > 0) {
            this.uiManager.drawingTool.saveState();
        }
        
        this.updateSensorList();
    }

    // 모든 센서 제거
    removeAllSensors() {
        this.sensors.forEach(sensor => {
            if (sensor.position) {
                this.removeSensorMarker(sensor.entity_id);
                sensor.position = undefined;
            }
        });
        this.addedSensors.clear();
        this.currentUnit = null;
        this.updateSensorList();
    }

    // 체크박스 변경 핸들러 수정
    handleCheckboxChange(e) {
        if (!this.enabled) {
            e.preventDefault();
            return;
        }

        const entityId = e.target.dataset.entityId;
        const sensor = this.sensors.find(s => s.entity_id === entityId);

        if (!sensor) return;

        if (e.target.checked) {
            // 단위 체크
            if (!this.checkAndHandleUnit(sensor)) {
                e.target.checked = false;
                return;
            }

            if (!sensor.position) {
                sensor.position = this.getRandomCenterPoint();
                this.addedSensors.add(sensor.entity_id);
                this.updateSensorMarker(sensor, sensor.position);
            }
        } else {
            sensor.position = undefined;
            this.removeSensorMarker(entityId);
            
            // 마지막 센서가 제거되면 currentUnit 초기화
            if (this.addedSensors.size === 0) {
                this.currentUnit = null;
            }
        }        
        this.uiManager.drawingTool.saveState();
    }

    // 드래그 앤 드롭 핸들러
    handleDragStart(e) {
        if (!this.enabled) return;
        e.dataTransfer.setData('text/plain', e.target.dataset.entityId);
        e.dataTransfer.effectAllowed = 'move';
    }

    handleDragOver(e) {
        if (!this.enabled) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }

    handleDrop(e) {
        if (!this.enabled) return;
        e.preventDefault();

        const entityId = e.dataTransfer.getData('text/plain');
        if (!entityId) return;

        const sensor = this.sensors.find(s => s.entity_id === entityId);
        if (sensor) {
            const point = this.clientToSVGPoint(e.clientX, e.clientY);
            this.updateSensorPosition(sensor, point);
        }
    }

    // 센서 위치 업데이트
    updateSensorPosition(sensor, point) {
        if (!this.enabled || !sensor) return;
        sensor.position = point;
        this.addedSensors.add(sensor.entity_id);
        this.updateSensorMarker(sensor, point);
    }

    // SVG 요소 생성 및 업데이트
    updateSensorMarker(sensor, point) {
        let group = this.svg.querySelector(`g[data-entity-id="${sensor.entity_id}"]`);

        if (!group) {
            group = this.createSensorMarkerGroup(sensor);
        } else {
            // 기존 그룹이 있는 경우, 컨텍스트 메뉴 핸들러 재설정
            this.setupContextMenuAndHold(group, sensor);
        }

        this.updateMarkerPosition(group, sensor, point);
        this.setupDragEvents(group, sensor, point);
    }

    createSensorMarkerGroup(sensor) {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('data-entity-id', sensor.entity_id);
        group.setAttribute('draggable', 'true');
        group.style.cursor = 'move';

        // 배경 사각형 생성
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('rx', '3');
        rect.setAttribute('ry', '3');
        rect.style.pointerEvents = 'none';
        rect.setAttribute('fill', 'white');
        rect.setAttribute('fill-opacity', '0.9');
        rect.classList.add('sensor-bg-rect');

        // 센서 위치 마커 생성 (드래그를 위한 투명한 원)
        const dragHandle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dragHandle.setAttribute('r', '10');  // 드래그 영역을 위한 충분한 크기
        dragHandle.setAttribute('fill', 'transparent');  // 투명하게 설정
        dragHandle.style.pointerEvents = 'all';  // 이벤트 처리 활성화
        dragHandle.classList.add('sensor-drag-handle');

        // 텍스트 생성
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.style.pointerEvents = 'none';
        text.style.userSelect = 'none';
        text.classList.add('sensor-text');

        group.appendChild(rect);
        group.appendChild(dragHandle);
        group.appendChild(text);

        // 호버 이벤트 설정
        this.setupHoverEvents(group);
        
        // 컨텍스트 메뉴와 hold 이벤트 설정
        this.setupContextMenuAndHold(group, sensor);

        this.svg.appendChild(group);
        return group;
    }

    setupHoverEvents(group) {
        const handleMouseEnter = () => {
            // 선택 도구일 때는 호버 효과를 적용하지 않음
            if (!this.enabled || this.uiManager.currentTool === 'select') return;
            
            // 배경 사각형 강조
            const rect = group.querySelector('.sensor-bg-rect');
            if (rect) {
                rect.setAttribute('fill', '#f0f9ff');  // 연한 파란색 배경
                rect.setAttribute('stroke', '#3b82f6');  // 파란색 테두리
                rect.setAttribute('stroke-width', '2');
            }

            // 마커 강조
            const marker = group.querySelector('.sensor-marker');
            if (marker) {
                marker.setAttribute('r', '6');  // 마커 크기 증가
                marker.setAttribute('fill', '#3b82f6');  // 파란색으로 변경
            }

            // 텍스트 강조
            const text = group.querySelector('.sensor-text');
            if (text) {
                text.setAttribute('fill', '#2563eb');  // 진한 파란색으로 변경
                text.style.fontWeight = 'bold';
            }
        };

        const handleMouseLeave = () => {
            // 선택 도구일 때는 호버 효과를 적용하지 않음
            if (!this.enabled || this.uiManager.currentTool === 'select') return;
            
            // 배경 사각형 원래대로
            const rect = group.querySelector('.sensor-bg-rect');
            if (rect) {
                rect.setAttribute('fill', 'white');
                rect.removeAttribute('stroke');
                rect.removeAttribute('stroke-width');
            }

            // 마커 원래대로
            const marker = group.querySelector('.sensor-marker');
            if (marker) {
                marker.setAttribute('r', '3');
                marker.setAttribute('fill', 'red');
            }

            // 텍스트 원래대로
            const text = group.querySelector('.sensor-text');
            if (text) {
                text.setAttribute('fill', 'black');
                text.style.fontWeight = 'normal';
            }
        };

        group.addEventListener('mouseenter', handleMouseEnter);
        group.addEventListener('mouseleave', handleMouseLeave);
    }

    setupContextMenuAndHold(group, sensor) {
        let holdTimer = null;
        const HOLD_DURATION = 1000; // 1초

        // 삭제 버튼 생성 함수
        const createDeleteButton = (x, y) => {
            const deleteGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            deleteGroup.classList.add('delete-button');
            deleteGroup.setAttribute('transform', `translate(${x},${y})`);
            deleteGroup.style.cursor = 'pointer';
            deleteGroup.style.pointerEvents = 'all';

            // 삭제 버튼 배경
            const buttonBg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            buttonBg.setAttribute('r', '15');
            buttonBg.setAttribute('fill', '#ef4444');
            buttonBg.setAttribute('stroke', 'white');
            buttonBg.setAttribute('stroke-width', '2');
            buttonBg.style.pointerEvents = 'all';

            // X 아이콘
            const xIcon = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            xIcon.setAttribute('d', 'M-6,-6 L6,6 M-6,6 L6,-6');
            xIcon.setAttribute('stroke', 'white');
            xIcon.setAttribute('stroke-width', '2');
            xIcon.setAttribute('stroke-linecap', 'round');
            xIcon.style.pointerEvents = 'none';

            deleteGroup.appendChild(buttonBg);
            deleteGroup.appendChild(xIcon);

            // 삭제 처리 함수
            const handleDelete = (e) => {
                e.preventDefault();
                e.stopPropagation();
                // 모달 확인 창으로 변경
                this.uiManager.showConfirmModal(
                    '센서 삭제',
                    `'${sensor.attributes.friendly_name || sensor.entity_id}' 센서를 삭제하시겠습니까?`,
                    () => {
                        this.removeSensorMarker(sensor.entity_id);
                        const sensorIndex = this.sensors.findIndex(s => s.entity_id === sensor.entity_id);
                        if (sensorIndex !== -1) {
                            this.sensors[sensorIndex].position = undefined;
                        }
                        this.addedSensors.delete(sensor.entity_id);
                        this.uiManager.drawingTool.saveState();
                        this.updateSensorList();
                    },
                    null,
                    '삭제',
                    'bg-red-500 hover:bg-red-600'
                );
            };

            // 클릭 및 터치 이벤트
            [deleteGroup, buttonBg].forEach(element => {
                // 마우스 클릭
                element.addEventListener('click', handleDelete);
                
                // 터치 이벤트
                element.addEventListener('touchstart', (e) => {
                    e.preventDefault(); // 기본 동작 방지
                });
                
                element.addEventListener('touchend', (e) => {
                    e.preventDefault();
                    handleDelete(e);
                });
            });

            // 호버 효과
            const handleMouseEnter = () => {
                buttonBg.setAttribute('fill', '#dc2626');
            };

            const handleMouseLeave = () => {
                buttonBg.setAttribute('fill', '#ef4444');
            };

            deleteGroup.addEventListener('mouseenter', handleMouseEnter);
            deleteGroup.addEventListener('mouseleave', handleMouseLeave);

            return deleteGroup;
        };

        // 삭제 버튼 표시
        const showDeleteButton = () => {
            const existingButton = group.querySelector('.delete-button');
            if (existingButton) return;

            const marker = group.querySelector('.sensor-marker');
            if (marker) {
                const x = parseFloat(marker.getAttribute('cx'));
                const y = parseFloat(marker.getAttribute('cy')) - 40;
                const deleteButton = createDeleteButton(x, y);
                group.appendChild(deleteButton);
            }
        };

        // 삭제 버튼 숨기기
        const hideDeleteButton = () => {
            const deleteButton = group.querySelector('.delete-button');
            if (deleteButton) {
                deleteButton.remove();
            }
        };

        // 우클릭 이벤트
        group.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showDeleteButton();
            
            // 3초 후 자동으로 삭제 버튼 숨기기
            setTimeout(hideDeleteButton, 3000);
        });

        // 터치 이벤트 (hold)
        let touchStartTime = 0;
        let touchStartX = 0;
        let touchStartY = 0;
        const TOUCH_MOVE_THRESHOLD = 10; // 10px 이상 움직이면 드래그로 간주

        group.addEventListener('touchstart', (e) => {
            touchStartTime = Date.now();
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            
            holdTimer = setTimeout(() => {
                showDeleteButton();
                // 3초 후 자동으로 삭제 버튼 숨기기
                setTimeout(hideDeleteButton, 3000);
            }, HOLD_DURATION);
        });

        group.addEventListener('touchend', (e) => {
            const touchEndTime = Date.now();
            const touchDuration = touchEndTime - touchStartTime;

            if (holdTimer) {
                clearTimeout(holdTimer);
            }

            // 짧은 터치는 삭제 버튼을 숨김
            if (touchDuration < HOLD_DURATION) {
                hideDeleteButton();
            }
        });

        group.addEventListener('touchmove', (e) => {
            const touchMoveX = e.touches[0].clientX;
            const touchMoveY = e.touches[0].clientY;
            const moveDistance = Math.sqrt(
                Math.pow(touchMoveX - touchStartX, 2) + 
                Math.pow(touchMoveY - touchStartY, 2)
            );

            // 일정 거리 이상 움직였으면 hold 타이머 취소
            if (moveDistance > TOUCH_MOVE_THRESHOLD) {
                if (holdTimer) {
                    clearTimeout(holdTimer);
                }
            }
        });

        // SVG 영역 클릭 시 삭제 버튼 숨기기
        this.svg.addEventListener('click', (e) => {
            if (!group.contains(e.target)) {
                hideDeleteButton();
            }
        });
    }

    updateMarkerPosition(group, sensor, point) {
        // 기존 요소들 제거
        const oldMarker = group.querySelector('.sensor-marker');
        const oldText = group.querySelector('text');
        const oldRect = group.querySelector('rect');
        if (oldMarker) oldMarker.remove();
        if (oldText) oldText.remove();
        if (oldRect) oldRect.remove();

        // 기본 스타일 정의
        const DEFAULT_MARKER_SIZE = 3;
        const DEFAULT_MARKER_COLOR = 'red';
        const DEFAULT_TEXT_SIZE = 14;
        const DEFAULT_TEXT_COLOR = 'black';
        const DEFAULT_BG_COLOR = 'white';
        const DEFAULT_BG_OPACITY = 0.9;

        // 새 마커 생성
        const markerPath = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        markerPath.classList.add('sensor-marker');
        markerPath.setAttribute('cx', String(point.x));
        markerPath.setAttribute('cy', String(point.y));
        markerPath.setAttribute('r', String(DEFAULT_MARKER_SIZE));
        markerPath.setAttribute('fill', DEFAULT_MARKER_COLOR);
        markerPath.style.pointerEvents = 'none';

        // 드래그 핸들 위치 업데이트
        const dragHandle = group.querySelector('circle');
        dragHandle.setAttribute('cx', String(point.x));
        dragHandle.setAttribute('cy', String(point.y));

        // 텍스트 생성 및 설정
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', String(point.x));
        text.setAttribute('y', String(point.y - DEFAULT_MARKER_SIZE - 2 * DEFAULT_TEXT_SIZE));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.style.userSelect = 'none';

        // 보정된 온도값 계산
        const calibratedTemp = this.getCalibratedTemperature(sensor);

        // 센서 이름 표시
        const nameText = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        nameText.textContent = sensor.attributes.friendly_name || sensor.entity_id;
        nameText.setAttribute('x', String(point.x));
        nameText.setAttribute('font-size', String(DEFAULT_TEXT_SIZE));
        nameText.setAttribute('fill', DEFAULT_TEXT_COLOR);
        nameText.style.userSelect = 'none';
        text.appendChild(nameText);

        // 온도 표시 (보정된 값과 단위 포함)
        const tempText = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        const unit = sensor.attributes?.unit_of_measurement || '';
        tempText.textContent = `${calibratedTemp.toFixed(1)}${unit}`;
        tempText.setAttribute('x', String(point.x));
        tempText.setAttribute('dy', String(DEFAULT_TEXT_SIZE + 2));
        tempText.setAttribute('font-size', String(DEFAULT_TEXT_SIZE));
        tempText.setAttribute('fill', DEFAULT_TEXT_COLOR);
        tempText.style.userSelect = 'none';
        text.appendChild(tempText);

        // 임시로 SVG에 직접 추가하여 BBox 계산
        this.svg.appendChild(text);
        const textBBox = text.getBBox();
        this.svg.removeChild(text);

        // 배경 사각형 생성 및 설정
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        const padding = 8;
        rect.setAttribute('x', String(point.x - textBBox.width / 2 - padding));
        rect.setAttribute('y', String(point.y - textBBox.height - DEFAULT_MARKER_SIZE - padding));
        rect.setAttribute('width', String(textBBox.width + padding * 2));
        rect.setAttribute('height', String(textBBox.height + padding * 2));
        rect.setAttribute('fill', DEFAULT_BG_COLOR);
        rect.setAttribute('fill-opacity', String(DEFAULT_BG_OPACITY));
        rect.setAttribute('rx', '3');
        rect.setAttribute('ry', '3');
        rect.style.pointerEvents = 'none';

        // 요소들을 그룹에 추가 (순서 중요)
        group.appendChild(rect);        // 배경 먼저
        group.appendChild(markerPath);  // 그 다음 마커
        group.appendChild(text);        // 마지막으로 텍스트
    }

    setupDragEvents(group, sensor, point) {
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let offsetX = 0;
        let offsetY = 0;
        let dragStartPoint = { x: 0, y: 0 };

        const handleMouseDown = (e) => {
            if (!this.enabled) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;

            dragStartPoint = this.clientToSVGPoint(e.clientX, e.clientY);
            offsetX = dragStartPoint.x - point.x;
            offsetY = dragStartPoint.y - point.y;

            group.style.pointerEvents = 'none';
            e.stopPropagation();
        };

        const handleMouseMove = (e) => {
            if (!isDragging) return;
            const currentSVGPoint = this.clientToSVGPoint(e.clientX, e.clientY);

            const newPoint = {
                x: currentSVGPoint.x - offsetX,
                y: currentSVGPoint.y - offsetY
            };
            this.updateMarkerPosition(group, sensor, newPoint);
            sensor.position = newPoint;
            point = newPoint;
            e.stopPropagation();
        };

        const handleMouseUp = (e) => {
            if (!isDragging) return;
            isDragging = false;
            group.style.pointerEvents = 'auto';
            e.stopPropagation();
            if (this.uiManager.drawingTool) {
                this.uiManager.drawingTool.saveState();
            }
        };

        // 기존 이벤트 리스너 제거
        if (group._eventHandlers) {
            group.removeEventListener('mousedown', group._eventHandlers.mouseDown);
            document.removeEventListener('mousemove', group._eventHandlers.mouseMove);
            document.removeEventListener('mouseup', group._eventHandlers.mouseUp);
        }

        // 새로운 핸들러 등록
        group._eventHandlers = {
            mouseDown: handleMouseDown,
            mouseMove: handleMouseMove,
            mouseUp: handleMouseUp
        };

        group.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }

    removeSensorMarker(entityId) {
        const marker = this.svg.querySelector(`g[data-entity-id="${entityId}"]`);
        if (marker) {
            marker.remove();            
        }
    }

    // 좌표 변환
    clientToSVGPoint(clientX, clientY) {
        const rect = this.svg.getBoundingClientRect();
        // svg는 1:1 ratio
        const rect_size = Math.min(rect.width, rect.height)
        const scaleX = this.viewBox.width / rect_size;
        const scaleY = this.viewBox.height / rect_size;
        
        let x = (clientX - rect.left) * scaleX + this.viewBox.minX;
        let y = (clientY - rect.top) * scaleY + this.viewBox.minY;
        
        // // viewbox 범위 내로 제한
        // x = Math.max(this.viewBox.minX, Math.min(x, this.viewBox.minX + this.viewBox.width));
        // y = Math.max(this.viewBox.minY, Math.min(y, this.viewBox.minY + this.viewBox.height));
        
        return { x, y };
    }

    // SVG 좌표를 클라이언트 좌표로 변환
    svgToClientPoint(svgX, svgY) {
        const rect = this.svg.getBoundingClientRect();
        const scaleX = rect.width / this.viewBox.width;
        const scaleY = rect.height / this.viewBox.height;

        return {
            x: (svgX - this.viewBox.minX) * scaleX + rect.left,
            y: (svgY - this.viewBox.minY) * scaleY + rect.top
        };
    }

    // 유틸리티 메서드
    getRandomCenterPoint() {
        const { minX, minY, width, height } = this.viewBox;
        const randX = Math.round(Math.random() * 100) - 50;
        const randY = Math.round(Math.random() * 100) - 50;
        return {
            x: (minX + width / 2) + randX,
            y: (minY + height / 2) + randY
        };
    }

    // 보정된 온도값 반환
    getCalibratedTemperature(sensor) {
        const rawTemp = parseFloat(sensor.state);
        const calibration = sensor.calibration || 0;
        return rawTemp + calibration;
    }

    // 현재 센서 데이터 반환
    getSensors() {
        return this.sensors.filter(sensor => sensor.position);
    }

    // 설정 저장을 위한 센서 데이터 반환
    getSensorConfig() {
        return {
            unit: this.currentUnit,
            sensors: this.sensors
                .filter(sensor => sensor.position)
                .map(sensor => ({
                    entity_id: sensor.entity_id,
                    position: sensor.position,
                    calibration: sensor.calibration || 0
                }))
        };
    }

    // SVG 요소로부터 센서 정보 파싱
    parseSensorsFromSVG() {
        // addedSensors 초기화
        this.addedSensors.clear();

        const sensorGroups = this.svg.querySelectorAll('g[data-entity-id]');
        sensorGroups.forEach(group => {
            const entityId = group.getAttribute('data-entity-id');
            const sensor = this.sensors.find(s => s.entity_id === entityId);
            if (sensor) {
                const circle = group.querySelector('circle.sensor-marker');
                if (circle) {
                    const x = parseFloat(circle.getAttribute('cx'));
                    const y = parseFloat(circle.getAttribute('cy'));
                    sensor.position = { x, y };
                    
                    // addedSensors에 추가
                    this.addedSensors.add(entityId);

                    // 이벤트 핸들러 재등록
                    this.setupDragEvents(group, sensor, sensor.position);
                }
            }
        });

        // 센서 리스트 UI 업데이트
        this.updateSensorList();
    }
}