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

        // SVG 이벤트 리스너 등록
        this.svg.addEventListener('dragover', this.handleDragOver);
        this.svg.addEventListener('drop', this.handleDrop);
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
                
                // 저장된 센서 위치 정보를 현재 센서 데이터에 적용
                if (config.sensors) {
                    config.sensors.forEach(savedSensor => {
                        const sensor = this.sensors.find(s => s.entity_id === savedSensor.entity_id);
                        if (sensor && savedSensor.position) {
                            sensor.position = savedSensor.position;
                            this.updateSensorMarker(sensor, savedSensor.position);
                        }
                    });
                }
            }

            this.updateSensorList();
        } catch (error) {
            console.error('센서 정보를 불러오는데 실패했습니다:', error);
            // 에러 메시지를 UI에 표시
            const container = document.getElementById('sensor-container');
            if (container) {
                container.innerHTML = `
                    <div class="p-4 bg-red-50 border border-red-200 rounded-md">
                        <p class="text-red-600">센서 정보를 불러오는데 실패했습니다.</p>
                        <p class="text-sm text-red-500 mt-1">${error.message}</p>
                    </div>
                `;
            }
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

        container.innerHTML = this.sensors.map(sensor => {
            const isPlaced = sensor.position !== undefined;
            const draggableState = this.enabled && !isPlaced ? 'true' : 'false';
            const itemClass = isPlaced 
                ? 'sensor-item p-3 bg-gray-100 border border-gray-200 rounded-md shadow-sm opacity-50 cursor-not-allowed flex justify-between items-center'
                : `sensor-item p-3 bg-white border border-gray-200 rounded-md shadow-sm hover:shadow-md transition-shadow cursor-move flex justify-between items-center`;

            return `
                <div class="${itemClass}" 
                    draggable="${draggableState}" 
                    data-entity-id="${sensor.entity_id}">
                    <span class="font-medium">${sensor.attributes.friendly_name || sensor.entity_id}</span>
                    <span class="text-gray-600 ml-2">${sensor.state}°C</span>
                </div>
            `;
        }).join('');

        // 드래그 앤 드롭 이벤트 설정
        if (this.enabled) {
            container.querySelectorAll('.sensor-item').forEach(item => {
                if (item.getAttribute('draggable') === 'true') {
                    item.addEventListener('dragstart', this.handleDragStart);
                }
            });
        }
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

        const point = this.clientToSVGPoint(e.clientX, e.clientY);
        this.updateSensorPosition(entityId, point);
    }

    // 센서 위치 업데이트
    updateSensorPosition(entityId, point) {
        if (!this.enabled) return;
        const sensor = this.sensors.find(s => s.entity_id === entityId);
        if (sensor) {
            sensor.position = point;
            this.updateSensorMarker(sensor, point);
        }
    }

    // 센서 마커 업데이트
    updateSensorMarker(sensor, point) {
        // 기존 센서 마커 그룹 제거
        const oldGroup = this.svg.querySelector(`g[data-entity-id="${sensor.entity_id}"]`);
        if (oldGroup) this.svg.removeChild(oldGroup);

        // 새로운 마커 그룹 생성
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('data-entity-id', sensor.entity_id);
        
        // 센서 점 생성
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(point.x));
        circle.setAttribute('cy', String(point.y));
        circle.setAttribute('r', '5');
        circle.setAttribute('fill', 'red');
        circle.style.cursor = 'move';

        // 센서 이름 배경 생성
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', String(point.x));
        text.setAttribute('y', String(point.y - 10));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', 'black');
        text.setAttribute('font-size', '12');
        text.textContent = sensor.attributes.friendly_name || sensor.entity_id;
        text.style.cursor = 'move';
        text.style.userSelect = 'none';

        // 텍스트 배경을 위한 rect 생성
        const textBBox = text.getBBox ? text.getBBox() : { width: 100, height: 14 };
        const padding = 4;
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(point.x - textBBox.width/2 - padding));
        rect.setAttribute('y', String(point.y - 24));
        rect.setAttribute('width', String(textBBox.width + padding*2));
        rect.setAttribute('height', String(textBBox.height + padding));
        rect.setAttribute('fill', 'white');
        rect.setAttribute('fill-opacity', '0.8');
        rect.setAttribute('rx', '3');
        rect.setAttribute('ry', '3');
        rect.style.cursor = 'move';

        // 드래그 이벤트 처리를 위한 변수들
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let originalX = point.x;
        let originalY = point.y;

        // 마우스 이벤트 핸들러
        const handleMouseDown = (e) => {
            if (!this.enabled) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            originalX = point.x;
            originalY = point.y;
            group.style.pointerEvents = 'none';
        };

        const handleMouseMove = (e) => {
            if (!isDragging) return;
            
            const point = this.clientToSVGPoint(e.clientX, e.clientY);
            
            // 위치 업데이트
            circle.setAttribute('cx', String(point.x));
            circle.setAttribute('cy', String(point.y));
            text.setAttribute('x', String(point.x));
            text.setAttribute('y', String(point.y - 10));
            rect.setAttribute('x', String(point.x - textBBox.width/2 - padding));
            rect.setAttribute('y', String(point.y - 24));

            // 센서 위치 업데이트
            sensor.position = { x: point.x, y: point.y };
        };

        const handleMouseUp = () => {
            if (!isDragging) return;
            isDragging = false;
            group.style.pointerEvents = 'auto';
            // 드래그가 끝난 후 originalX, originalY 값을 현재 위치로 업데이트
            originalX = point.x;
            originalY = point.y;
        };

        // 이벤트 리스너 등록
        [circle, text, rect].forEach(element => {
            element.addEventListener('mousedown', handleMouseDown);
        });
        
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        // 그룹에 요소들 추가
        group.appendChild(rect);
        group.appendChild(text);
        group.appendChild(circle);
        
        this.svg.appendChild(group);
    }

    // 클라이언트 좌표를 SVG 좌표로 변환
    clientToSVGPoint(clientX, clientY) {
        const rect = this.svg.getBoundingClientRect();
        const scaleX = this.viewBox.width / rect.width;
        const scaleY = this.viewBox.height / rect.height;

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
            position: sensor.position || null
        }));
    }
} 