export class SensorManager {
    constructor(svgElement) {
        this.svg = svgElement;
        this.sensors = [];
        this.onSensorsUpdate = null;
        this.enabled = true;

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

          // 상수 정의
        this.MARKER_RADIUS = 5;
        this.MARKER_FILL = 'red';
        this.TEXT_FILL = 'black';
        this.TEXT_SIZE = '12';
        this.RECT_FILL = 'white';
        this.RECT_OPACITY = '0.8';
        this.RECT_RADIUS = '3';
    }

    enable() {
        this.enabled = true;
        this.updateSensorList();
    }

    disable() {
        this.enabled = false;
        this.updateSensorList();
    }

    // 센서 데이터 로드
    async loadSensors() {
        try {
            // 센서 상태 로드
            const response = await fetch('./api/states');
            const states = await response.json();
            this.sensors = states.filter(state =>
                state.attributes.device_class === 'temperature'
            );
            // 저장된 설정 로드
            const configResponse = await fetch('./api/load-config');
            if (configResponse.ok) {
                const config = await configResponse.json();
                console.log("SensorManager - 서버에서 받은 config:", config);
      
                // 저장된 센서 위치 정보를 현재 센서 데이터에 적용
                if (config.sensors) {
                    config.sensors.forEach(savedSensor => {
                        const sensor = this.sensors.find(s => s.entity_id === savedSensor.entity_id);
                        const placedSensor = this.svg.querySelector(`g[data-entity-id="${savedSensor.entity_id}"]`);
                        if (sensor && savedSensor.position && ! placedSensor) {
                            sensor.position = savedSensor.position;
                            sensor.calibration = savedSensor.calibration || 0;
                            this.updateSensorMarker(sensor, savedSensor.position);
                        }
                    });
                }
            }
      
            this.updateSensorList();
        } catch (error) {
            console.error('센서 정보를 불러오는데 실패했습니다:', error);
              this.displayError(`센서 정보를 불러오는데 실패했습니다: ${error.message}`);
        }
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
    
   // 센서 목록 UI 업데이트
    updateSensorList() {
        const container = document.getElementById('sensor-container');
        if (!container) return;

        if (!this.sensors || this.sensors.length === 0) {
            container.innerHTML = `
                <div class="p-4 bg-yellow-50 border border-yellow-200 rounded-md">
                    <p class="text-yellow-600">사용 가능한 온도 센서가 없습니다.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.sensors.map(sensor => this.createSensorListItem(sensor)).join('');
        
        // 체크박스 이벤트 설정
        if(this.enabled) {
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
         const isPlaced = sensor.position !== undefined;
        const itemClass = 'sensor-item p-3 bg-white border border-gray-200 rounded-md shadow-sm hover:shadow-md transition-shadow cursor-pointer flex justify-between items-center';
        const calibration = sensor.calibration || 0;
        const calibratedTemp = parseFloat(sensor.state) + calibration;

        return `
            <div class="${itemClass}" data-entity-id="${sensor.entity_id}">
                <div class="flex-1">
                     <div class="flex items-center">
                        <input type="checkbox"
                            class="sensor-checkbox mr-2"
                            data-entity-id="${sensor.entity_id}"
                            ${isPlaced ? 'checked' : ''}
                            ${this.enabled ? '' : 'disabled'}
                        >
                        <span class="font-medium">${sensor.attributes.friendly_name || sensor.entity_id}</span>
                    </div>
                    <div class="flex items-center mt-1">
                        <span class="text-xs text-gray-600 mr-2">측정값: ${sensor.state}°C</span>
                        <span class="text-xs text-blue-600">보정값: 
                            <input type="number" 
                                class="calibration-input text-xs w-16 px-1 py-0.5 border border-gray-300 rounded"
                                value="${calibration}"
                                step="0.1"
                                data-entity-id="${sensor.entity_id}"
                                ${this.enabled ? '' : 'disabled'}
                            > °C
                        </span>
                        <span class="text-xs text-green-600 ml-2">보정후: ${calibratedTemp.toFixed(1)}°C</span>
                    </div>
                </div>
            </div>
        `;
    }
    handleCalibrationChange(e) {
        const entityId = e.target.dataset.entityId;
        const calibration = parseFloat(e.target.value) || 0;
        const sensor = this.sensors.find(s => s.entity_id === entityId);
        if (sensor) {
            sensor.calibration = calibration;
            this.updateSensorList();
        }
    }

    // 체크박스 변경 핸들러
    handleCheckboxChange(e) {
        if (!this.enabled) {
            e.preventDefault();
            return;
        }

        const entityId = e.target.dataset.entityId;
        const sensor = this.sensors.find(s => s.entity_id === entityId);

        if (!sensor) return;

        if (e.target.checked) {
            if (!sensor.position) {
                 sensor.position = this.getRandomCenterPoint();
                this.updateSensorMarker(sensor,  sensor.position);
            }

        } else {
             sensor.position = undefined;
            this.removeSensorMarker(entityId);
        }
    }
   getRandomCenterPoint() {
        const {minX, minY, width, height} = this.viewBox;
        const randX = Math.round(Math.random()*100) -50;
        const randY = Math.round(Math.random()*100) -50;
            return {
                x: (minX + width / 2) + randX,
                y: (minY + height / 2) + randY
            };
    }
    removeSensorMarker(entityId) {
           const marker = this.svg.querySelector(`g[data-entity-id="${entityId}"]`);
           if (marker) marker.remove();
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
        if(sensor){
           const point = this.clientToSVGPoint(e.clientX, e.clientY);
            this.updateSensorPosition(sensor, point);
        }
    }

    // 센서 위치 업데이트
    updateSensorPosition(sensor, point) {
        if (!this.enabled || !sensor) return;
        sensor.position = point;
        this.updateSensorMarker(sensor, point);
    }

  
   // 센서 마커 업데이트
   updateSensorMarker(sensor, point) {
        let group = this.svg.querySelector(`g[data-entity-id="${sensor.entity_id}"]`);

        if (!group) {
            group = this.createSensorMarkerGroup(sensor);
        }
        this.updateMarkerPosition(group,sensor, point);
        this.setupDragEvents(group, sensor, point);
    }

    createSensorMarkerGroup(sensor) {
            const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            group.setAttribute('data-entity-id', sensor.entity_id);

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('r', String(this.MARKER_RADIUS));
            circle.setAttribute('fill', this.MARKER_FILL);
            circle.style.cursor = 'move';

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('fill', this.TEXT_FILL);
            text.setAttribute('font-size', this.TEXT_SIZE);
            text.style.cursor = 'move';
            text.style.userSelect = 'none';

            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('fill', this.RECT_FILL);
            rect.setAttribute('fill-opacity', this.RECT_OPACITY);
            rect.setAttribute('rx', this.RECT_RADIUS);
            rect.setAttribute('ry', this.RECT_RADIUS);
            rect.style.cursor = 'move';

            group.appendChild(rect);
            group.appendChild(text);
            group.appendChild(circle);
            this.svg.appendChild(group);

            return group;
        }
    updateMarkerPosition(group,sensor,point) {
        const circle = group.querySelector('circle');
        const text = group.querySelector('text');
        const rect = group.querySelector('rect');
        if (point.x !== parseFloat(circle.getAttribute('cx')) || point.y !== parseFloat(circle.getAttribute('cy'))){
            circle.setAttribute('cx', String(point.x));
            circle.setAttribute('cy', String(point.y));

            text.setAttribute('x', String(point.x));
            text.setAttribute('y', String(point.y - 10));
            // 텍스트 배경 크기 계산 및 업데이트
            const textBBox = text.getBBox ? text.getBBox() : { width: 100, height: 14 };
            const padding = 4;
            rect.setAttribute('x', String(point.x - textBBox.width/2 - padding));
            rect.setAttribute('y', String(point.y - 24));
        }
          if(text.textContent !== (sensor.attributes.friendly_name || sensor.entity_id))
            text.textContent = sensor.attributes.friendly_name || sensor.entity_id;

    }

    setupDragEvents(group, sensor, point) {
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let offsetX = 0;
        let offsetY = 0;
        let dragStartPoint = { x: 0, y: 0 };
        
        const circle = group.querySelector('circle');
        const text = group.querySelector('text');
        const rect = group.querySelector('rect');
        const handleMouseDown = (e) => {
            if (!this.enabled) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;

            dragStartPoint = this.clientToSVGPoint(e.clientX, e.clientY);

            offsetX = dragStartPoint.x - point.x;
            offsetY = dragStartPoint.y - point.y;

            group.style.pointerEvents = 'none';
        };
        const handleMouseMove = (e) => {
             if (!isDragging) return;
           const currentSVGPoint = this.clientToSVGPoint(e.clientX, e.clientY);

            const newPoint = {
                x: currentSVGPoint.x - offsetX,
                y: currentSVGPoint.y - offsetY
            };
             this.updateMarkerPosition(group,sensor,newPoint);
            sensor.position = newPoint;
            point = newPoint;
        };
        const handleMouseUp = () => {
            if (!isDragging) return;
            isDragging = false;
            group.style.pointerEvents = 'auto';
        };
        if (group._eventHandlers) {
            // 기존 이벤트 리스너 제거
            [circle, text, rect].forEach(element => {
                element.removeEventListener('mousedown', group._eventHandlers.mouseDown);
            });
            document.removeEventListener('mousemove', group._eventHandlers.mouseMove);
            document.removeEventListener('mouseup', group._eventHandlers.mouseUp);
         }
           // 새로운 핸들러 등록
        group._eventHandlers = {
           mouseDown: handleMouseDown,
           mouseMove: handleMouseMove,
           mouseUp: handleMouseUp
        };  
        [circle, text, rect].forEach(element => {
            element.addEventListener('mousedown', group._eventHandlers.mouseDown);
        });
        document.addEventListener('mousemove', group._eventHandlers.mouseMove);
        document.addEventListener('mouseup', group._eventHandlers.mouseUp);

    }
    // 클라이언트 좌표를 SVG 좌표로 변환
    clientToSVGPoint(clientX, clientY) {
        const rect = this.svg.getBoundingClientRect();
        // svg는 1:1 ratio
        const rect_size = Math.min(rect.width, rect.height)
        const scaleX = this.viewBox.width / rect_size;
        const scaleY = this.viewBox.height / rect_size;
        return {
            x: (clientX - rect.left) * scaleX + this.viewBox.minX,
            y: (clientY - rect.top) * scaleY + this.viewBox.minY
        };
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

    // 현재 센서 데이터 반환
    getSensors() {
        return this.sensors;
    }

    // 설정 저장을 위한 센서 데이터 반환
    getSensorConfig() {
        return this.sensors.map(sensor => ({
            entity_id: sensor.entity_id,
            position: sensor.position || null,
            calibration: sensor.calibration || 0
        }));
    }

    // 보정된 온도값 반환
    getCalibratedTemperature(sensor) {
        const rawTemp = parseFloat(sensor.state);
        const calibration = sensor.calibration || 0;
        return rawTemp + calibration;
    }
}